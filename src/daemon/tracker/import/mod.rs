//! Import and sync: one tracker listing, adopted into the backlog.
//!
//! Import and sync are the same fetch (ADR-0002): the listing that finds issues
//! warpforge has never seen also refreshes the ones it already tracks.

mod adopt;
mod fetch;
mod status;

#[cfg(test)]
mod tests;

pub use adopt::adopt_imported;
pub use fetch::fetch_importable;
pub use status::fetch_links_status;
