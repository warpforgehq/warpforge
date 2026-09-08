//! Retiring the PR Assistant's tasks: nobody sees them on the board, so
//! nobody archives them — hence a TTL and a cap of their own (ADR-0010).

use crate::daemon::actor::{Command, Daemon};

pub(crate) const PR_REVIEW_ORIGIN: &str = "pr-review";

const PR_REVIEW_TTL_DAYS: i64 = 14;

const PR_REVIEW_KEEP: usize = 50;

impl Daemon {
    /// Delete tasks past the TTL and the oldest beyond the cap. Off the
    /// loop, through the ordinary `DeleteTask` path.
    pub(crate) fn sweep_pr_review_tasks(&self) {
        let persist = self.persist.clone();
        let store = self.store.clone();
        let cmd_tx = self.cmd_tx.clone();
        tokio::spawn(async move {
            // The triggering task may still be in the write queue.
            persist.flush().await;
            let cutoff = crate::daemon::task::now_secs() as i64 - PR_REVIEW_TTL_DAYS * 24 * 60 * 60;
            let ids = crate::daemon::runtime::store_read(store, move |store| {
                store
                    .find_stale_origin_tasks(PR_REVIEW_ORIGIN, cutoff, PR_REVIEW_KEEP)
                    .unwrap_or_default()
            })
            .await
            .unwrap_or_default();
            for id in ids {
                let (tx, rx) = tokio::sync::oneshot::channel();
                if cmd_tx
                    .send(Command::DeleteTask { id, reply: tx })
                    .await
                    .is_err()
                {
                    break;
                }
                let _ = rx.await;
            }
        });
    }
}
