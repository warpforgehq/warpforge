//! Google sign-in through `agy acp --login`: it prints a Google link, then
//! reads the code the Antigravity page shows from stdin and stores the login
//! where `agy acp` reads it. ACP `authenticate` does not sign agy in.

use std::path::Path;
use std::process::Stdio;
use std::sync::Arc;
use std::time::Duration;

use tokio::io::{AsyncBufReadExt, AsyncRead, AsyncWriteExt, BufReader};
use tokio::process::{Child, ChildStdin, Command};
use tokio::sync::{oneshot, Mutex};

use crate::daemon::accounts::AgentEnv;

/// agy is a one-file bundle that unpacks itself on every launch.
const LINK_TIMEOUT: Duration = Duration::from_secs(90);
const FINISH_TIMEOUT: Duration = Duration::from_secs(120);
const FLOW_LIFETIME: Duration = Duration::from_secs(15 * 60);
const OUTPUT_CAP: usize = 16 * 1024;

struct Flow {
    generation: u64,
    child: Child,
    stdin: ChildStdin,
    output: Arc<std::sync::Mutex<String>>,
    readers: Vec<tokio::task::JoinHandle<()>>,
}

static FLOW: Mutex<Option<Flow>> = Mutex::const_new(None);
static GENERATION: std::sync::atomic::AtomicU64 = std::sync::atomic::AtomicU64::new(0);

/// Start a sign-in, replacing (and killing) any earlier one.
/// @param acp_command the agent's ACP command, e.g. `agy acp`
/// @param cwd where to run it
/// @param env the account environment a session would get
/// @returns the Google sign-in link to show the user
pub(crate) async fn start(acp_command: &str, cwd: &Path, env: &AgentEnv) -> Result<String, String> {
    let mut slot = FLOW.lock().await;
    *slot = None;
    let mut cmd = Command::new("sh");
    cmd.args(["-c", &format!("{acp_command} --login")])
        .current_dir(cwd)
        .envs(&env.set)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .kill_on_drop(true);
    for key in &env.remove {
        cmd.env_remove(key);
    }
    let mut child = cmd
        .spawn()
        .map_err(|e| format!("could not start Antigravity sign-in: {e}"))?;
    let stdin = child.stdin.take().ok_or("sign-in has no stdin")?;
    let output = Arc::new(std::sync::Mutex::new(String::new()));
    let (link_tx, link_rx) = oneshot::channel();
    let mut readers = Vec::new();
    if let Some(stdout) = child.stdout.take() {
        readers.push(tokio::spawn(read_lines(
            stdout,
            output.clone(),
            Some(link_tx),
        )));
    }
    if let Some(stderr) = child.stderr.take() {
        readers.push(tokio::spawn(read_lines(stderr, output.clone(), None)));
    }
    let link = match tokio::time::timeout(LINK_TIMEOUT, link_rx).await {
        Ok(Ok(link)) => link,
        _ => {
            let _ = child.start_kill();
            return Err(failure(
                "Antigravity did not print a Google sign-in link",
                &output,
            ));
        }
    };
    let generation = GENERATION.fetch_add(1, std::sync::atomic::Ordering::Relaxed) + 1;
    *slot = Some(Flow {
        generation,
        child,
        stdin,
        output,
        readers,
    });
    tokio::spawn(async move {
        tokio::time::sleep(FLOW_LIFETIME).await;
        let mut slot = FLOW.lock().await;
        if slot.as_ref().is_some_and(|f| f.generation == generation) {
            *slot = None;
        }
    });
    Ok(link)
}

/// Hand the code from the Antigravity page to the running sign-in and wait
/// for it to store the login.
/// @param code the code, or the page's full address
/// @returns why the sign-in failed
pub(crate) async fn finish(code: &str) -> Result<(), String> {
    let code = valid_code(code).ok_or("that does not look like an Antigravity sign-in code")?;
    let Some(mut flow) = FLOW.lock().await.take() else {
        return Err("no sign-in is running; start it again".into());
    };
    flow.stdin
        .write_all(format!("{code}\n").as_bytes())
        .await
        .map_err(|e| format!("could not send the code: {e}"))?;
    drop(flow.stdin);
    let waited = tokio::time::timeout(FINISH_TIMEOUT, flow.child.wait()).await;
    for reader in flow.readers {
        let _ = tokio::time::timeout(Duration::from_secs(2), reader).await;
    }
    match waited {
        Ok(Ok(status)) if status.success() => Ok(()),
        Ok(_) => Err(failure("Antigravity rejected the sign-in", &flow.output)),
        Err(_) => Err(failure("Antigravity sign-in did not finish", &flow.output)),
    }
}

/// A single-line code or callback address; anything that could smuggle a
/// second line into agy's stdin is rejected.
fn valid_code(code: &str) -> Option<&str> {
    let code = code.trim();
    (!code.is_empty() && code.len() <= 4096 && !code.chars().any(char::is_whitespace))
        .then_some(code)
}

fn google_link(line: &str) -> Option<&str> {
    let line = line.trim();
    (line.starts_with("https://accounts.google.com/") && !line.contains(char::is_whitespace))
        .then_some(line)
}

async fn read_lines(
    stream: impl AsyncRead + Unpin,
    output: Arc<std::sync::Mutex<String>>,
    mut link: Option<oneshot::Sender<String>>,
) {
    let mut lines = BufReader::new(stream).lines();
    while let Ok(Some(line)) = lines.next_line().await {
        if let Some(url) = google_link(&line) {
            if let Some(tx) = link.take() {
                let _ = tx.send(url.to_string());
            }
        }
        let mut out = output.lock().unwrap();
        if out.len() < OUTPUT_CAP {
            out.push_str(&line);
            out.push('\n');
        }
    }
}

fn failure(what: &str, output: &std::sync::Mutex<String>) -> String {
    let output = output.lock().unwrap();
    let tail: Vec<&str> = output.lines().rev().take(5).collect();
    if tail.is_empty() {
        format!("{what}.")
    } else {
        let tail: Vec<&str> = tail.into_iter().rev().collect();
        format!("{what}: {}", tail.join(" "))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn accepts_a_code_or_callback_address_on_one_line() {
        assert_eq!(valid_code("  4/0AbC-xyz_1 \n"), Some("4/0AbC-xyz_1"));
        assert_eq!(
            valid_code("https://antigravity.google/oauth-callback?code=a&state=b"),
            Some("https://antigravity.google/oauth-callback?code=a&state=b")
        );
        assert_eq!(valid_code(""), None);
        assert_eq!(valid_code("abc\ndef"), None);
        assert_eq!(valid_code("abc def"), None);
    }

    #[test]
    fn picks_only_a_google_link() {
        assert_eq!(
            google_link("  https://accounts.google.com/o/oauth2/auth?x=1 "),
            Some("https://accounts.google.com/o/oauth2/auth?x=1")
        );
        assert_eq!(google_link("Open https://accounts.google.com/x"), None);
        assert_eq!(google_link("https://evil.test/accounts.google.com/"), None);
    }

    #[tokio::test]
    async fn a_scripted_login_returns_the_link_then_takes_the_code() {
        let dir = tempfile::tempdir().unwrap();
        let script = dir.path().join("fake-agy");
        std::fs::write(
            &script,
            "#!/bin/sh\necho 'Open the link:'\necho 'https://accounts.google.com/o/oauth2/auth?s=1'\n\
             read code\n[ \"$code\" = good ] || { echo bad code >&2; exit 1; }\n",
        )
        .unwrap();
        std::process::Command::new("chmod")
            .arg("755")
            .arg(&script)
            .status()
            .unwrap();
        let command = script.to_str().unwrap().to_string();
        let env = AgentEnv::default();

        let link = start(&command, dir.path(), &env).await.unwrap();
        assert_eq!(link, "https://accounts.google.com/o/oauth2/auth?s=1");
        assert!(finish("bad").await.unwrap_err().contains("bad code"));

        start(&command, dir.path(), &env).await.unwrap();
        finish("good").await.unwrap();
        assert!(finish("good").await.is_err());
    }
}
