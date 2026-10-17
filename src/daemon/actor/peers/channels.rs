//! Named channels (ADR 0026 addendum): the user creates them and adds Smiths;
//! `#general` is implicit, and a record with no channel belongs to it.

use std::collections::HashMap;

use warpforge_protocol as wire;

use crate::daemon::actor::{Daemon, Event};
use crate::daemon::runtime::Write as PersistWrite;
use crate::daemon::store::{StoredChannel, GENERAL_CHANNEL};
use crate::daemon::task::now_secs;

const NAME_MAX: usize = 32;

fn check_channel_name(name: &str) -> Result<String, String> {
    let name = name.trim().trim_start_matches('#').to_ascii_lowercase();
    let word = !name.is_empty()
        && name.len() <= NAME_MAX
        && name
            .chars()
            .all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == '-' || c == '_');
    if !word {
        return Err(format!(
            "a channel name is one word of a-z, 0-9, - or _, at most {NAME_MAX} characters"
        ));
    }
    if name == GENERAL_CHANNEL {
        return Err("#general is every project's own channel".into());
    }
    Ok(name)
}

impl Daemon {
    /// @param project only this project's channels, when given
    /// @param task_id only the channels this task is in, when given
    /// @returns the channels, by project then name
    pub(super) fn channels_list(
        &self,
        project: Option<&str>,
        task_id: Option<&str>,
    ) -> Vec<wire::Channel> {
        let rooms = task_id.map(|task| self.channels_of(task));
        let mut channels: Vec<_> = self
            .peers
            .channels
            .values()
            .filter(|c| project.is_none_or(|p| c.project == p))
            .filter(|c| rooms.as_ref().is_none_or(|r| r.contains_key(&c.id)))
            .map(|c| self.channel_view(c))
            .collect();
        channels.sort_by(|a, b| (&a.project, &a.name).cmp(&(&b.project, &b.name)));
        channels
    }

    pub(super) fn channel_create(
        &mut self,
        project: &str,
        name: &str,
    ) -> Result<wire::Channel, String> {
        if self.project_path(project).is_none() {
            return Err(format!("unknown project {project}"));
        }
        let name = check_channel_name(name)?;
        self.channel_name_free(project, &name, None)?;
        let channel = StoredChannel {
            id: format!("ch_{}", &uuid::Uuid::new_v4().to_string()[..8]),
            project: project.to_string(),
            name,
            created_at: now_secs(),
            members: Vec::new(),
        };
        Ok(self.channel_save(channel))
    }

    pub(super) fn channel_rename(&mut self, id: &str, name: &str) -> Result<wire::Channel, String> {
        let mut channel = self.channel(id)?.clone();
        let name = check_channel_name(name)?;
        self.channel_name_free(&channel.project, &name, Some(id))?;
        channel.name = name;
        Ok(self.channel_save(channel))
    }

    /// The channel goes; its records stay in the feed and reach no digest.
    pub(super) fn channel_delete(&mut self, id: &str) -> Result<(), String> {
        self.peers
            .channels
            .remove(id)
            .ok_or_else(|| format!("unknown channel {id}"))?;
        self.persist
            .write(PersistWrite::DeleteChannel(id.to_string()));
        self.emit(Event::ChannelRemoved { id: id.to_string() });
        Ok(())
    }

    /// @param member add the Smith when true, remove it when false
    pub(super) fn channel_set_member(
        &mut self,
        id: &str,
        smith_id: &str,
        member: bool,
    ) -> Result<wire::Channel, String> {
        let mut channel = self.channel(id)?.clone();
        let present = channel.members.iter().any(|m| m == smith_id);
        if member && !present {
            let smith = self
                .smiths_get(smith_id)
                .ok_or_else(|| format!("unknown Smith {smith_id}"))?;
            if !smith.allowed_projects.contains(&channel.project) {
                return Err(format!(
                    "{} is not allowed in {}; allow the project first",
                    smith.name, channel.project
                ));
            }
            channel.members.push(smith_id.to_string());
        } else if !member && present {
            channel.members.retain(|m| m != smith_id);
        } else {
            return Ok(self.channel_view(&channel));
        }
        Ok(self.channel_save(channel))
    }

    /// Take a Smith out of every channel outside the projects it is still
    /// allowed in, so a membership cannot return with the project.
    /// @param smith_id the Smith
    /// @param allowed its projects now; empty for a deleted Smith
    pub(crate) fn channels_drop_smith(&mut self, smith_id: &str, allowed: &[String]) {
        let held: Vec<_> = self
            .peers
            .channels
            .values()
            .filter(|c| c.members.iter().any(|m| m == smith_id))
            .filter(|c| !allowed.contains(&c.project))
            .cloned()
            .collect();
        for mut channel in held {
            channel.members.retain(|m| m != smith_id);
            self.channel_save(channel);
        }
    }

    /// The named channels `task_id` reads and posts to: its Smith's, in the
    /// projects that Smith is allowed in. Any other session has none.
    /// @param task_id a task
    /// @returns channel id → name
    pub(crate) fn channels_of(&self, task_id: &str) -> HashMap<String, String> {
        let Some(smith) = self.smith_of_thread(task_id) else {
            return HashMap::new();
        };
        self.peers
            .channels
            .values()
            .filter(|c| {
                c.members.contains(&smith.id) && smith.allowed_projects.contains(&c.project)
            })
            .map(|c| (c.id.clone(), c.name.clone()))
            .collect()
    }

    /// Resolve `message_agent`'s `#name` (or `#project/name`) for `from`.
    /// Nothing is recorded for a refusal: the agent only learns the address
    /// was wrong.
    /// @param from the posting task
    /// @param project its project
    /// @param spec the target after `#`
    /// @returns the channel's project and id, `None` for `#general`
    pub(super) fn channel_for_post(
        &self,
        from: &str,
        project: &str,
        spec: &str,
    ) -> Result<(String, Option<String>), String> {
        let (scope, name) = match spec.split_once('/') {
            Some((scope, name)) => (Some(scope), name),
            None => (None, spec),
        };
        let name = name.to_ascii_lowercase();
        if name == GENERAL_CHANNEL {
            return match scope {
                None => Ok((project.to_string(), None)),
                Some(_) => Err("post to #general of your own project only".into()),
            };
        }
        let member = self.channels_of(from);
        let found: Vec<_> = self
            .peers
            .channels
            .values()
            .filter(|c| c.name == name && scope.is_none_or(|s| c.project == s))
            .collect();
        let mine: Vec<_> = found
            .iter()
            .filter(|c| member.contains_key(&c.id))
            .collect();
        match (mine.as_slice(), found.is_empty()) {
            ([channel], _) => Ok((channel.project.clone(), Some(channel.id.clone()))),
            ([], true) => Err(format!(
                "there is no channel #{spec}; list_agents names the channels you can post to"
            )),
            ([], false) => Err(format!(
                "you are not a member of #{spec}; the user adds members to channels"
            )),
            _ => Err(format!(
                "#{name} is a channel in several projects; post to #<project>/{name}"
            )),
        }
    }

    fn channel(&self, id: &str) -> Result<&StoredChannel, String> {
        self.peers
            .channels
            .get(id)
            .ok_or_else(|| format!("unknown channel {id}"))
    }

    fn channel_name_free(
        &self,
        project: &str,
        name: &str,
        except: Option<&str>,
    ) -> Result<(), String> {
        let taken = self
            .peers
            .channels
            .values()
            .any(|c| c.project == project && c.name == name && Some(c.id.as_str()) != except);
        match taken {
            true => Err(format!("{project} already has #{name}")),
            false => Ok(()),
        }
    }

    fn channel_save(&mut self, channel: StoredChannel) -> wire::Channel {
        let view = self.channel_view(&channel);
        self.persist
            .write(PersistWrite::Channel(Box::new(channel.clone())));
        self.peers.channels.insert(channel.id.clone(), channel);
        self.emit(Event::ChannelUpdated(Box::new(view.clone())));
        view
    }

    fn channel_view(&self, channel: &StoredChannel) -> wire::Channel {
        let members = channel
            .members
            .iter()
            .filter_map(|id| self.smiths_get(id))
            .map(|smith| wire::ChannelMember {
                smith_id: smith.id,
                name: smith.name,
            })
            .collect();
        let key = (channel.project.clone(), Some(channel.id.clone()));
        let last_post_at = self
            .peers
            .posts
            .get(&key)
            .and_then(|posts| posts.back())
            .map(|p| p.created_at);
        wire::Channel {
            id: channel.id.clone(),
            project: channel.project.clone(),
            name: channel.name.clone(),
            members,
            created_at: channel.created_at,
            last_post_at,
        }
    }
}
