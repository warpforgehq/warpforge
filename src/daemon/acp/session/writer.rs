use tokio::io::AsyncWriteExt;
use tokio::sync::mpsc;

// Writer: serialize outgoing frames (ndjson) to the agent's stdin.
pub(super) fn spawn_writer(
    task_id: String,
    mut stdin: tokio::process::ChildStdin,
    mut out_rx: mpsc::UnboundedReceiver<String>,
    debug: bool,
) {
    tokio::spawn(async move {
        while let Some(line) = out_rx.recv().await {
            if debug {
                eprintln!("[acp {task_id} >>] {line}");
            }
            if stdin.write_all(line.as_bytes()).await.is_err()
                || stdin.write_all(b"\n").await.is_err()
            {
                break;
            }
            let _ = stdin.flush().await;
        }
    });
}
