//! Where the process says things: stderr, one timestamped line at a time.
//!
//! Never stdout. On the stdio transport stdout *is* the JSON-RPC channel, and the main binary
//! can be either transport, so one rule holds everywhere rather than an exception per file.

use std::io::Write;
use std::time::{SystemTime, UNIX_EPOCH};

/// Write `line` to stderr behind an ISO 8601 UTC timestamp.
pub fn log(line: &str) {
    let mut stderr = std::io::stderr().lock();
    // A closed stderr is not a reason to stop serving.
    let _ = writeln!(stderr, "{} {line}", timestamp(SystemTime::now()));
    let _ = stderr.flush();
}

/// `at` as `YYYY-MM-DDTHH:MM:SS.mmmZ`, the shape `Date.toISOString()` printed.
fn timestamp(at: SystemTime) -> String {
    let since = at.duration_since(UNIX_EPOCH).unwrap_or_default();
    let secs = since.as_secs();
    let (year, month, day) = civil_from_days((secs / 86_400) as i64);
    let rem = secs % 86_400;
    format!(
        "{year:04}-{month:02}-{day:02}T{:02}:{:02}:{:02}.{:03}Z",
        rem / 3600,
        (rem % 3600) / 60,
        rem % 60,
        since.subsec_millis()
    )
}

/// Days since 1970-01-01 to a proleptic Gregorian date (Howard Hinnant's algorithm).
fn civil_from_days(days: i64) -> (i64, u32, u32) {
    let z = days + 719_468;
    let era = z.div_euclid(146_097);
    let doe = z.rem_euclid(146_097);
    let yoe = (doe - doe / 1460 + doe / 36_524 - doe / 146_096) / 365;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let day = (doy - (153 * mp + 2) / 5 + 1) as u32;
    let month = if mp < 10 { mp + 3 } else { mp - 9 } as u32;
    let year = yoe + era * 400 + i64::from(month <= 2);
    (year, month, day)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::time::Duration;

    #[test]
    fn timestamps_are_iso_8601_utc() {
        assert_eq!(timestamp(UNIX_EPOCH), "1970-01-01T00:00:00.000Z");
        let at = UNIX_EPOCH + Duration::from_millis(1_794_672_000_123);
        assert_eq!(timestamp(at), "2026-11-14T16:00:00.123Z");
        let leap = UNIX_EPOCH + Duration::from_secs(951_782_400);
        assert_eq!(timestamp(leap), "2000-02-29T00:00:00.000Z");
    }
}
