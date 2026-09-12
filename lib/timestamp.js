// Parse an image filename into a start time in seconds, or null if it doesn't
// encode a timestamp. Naming is colon-free (Windows-safe): mm-ss / mm_ss,
// hh-mm-ss, bare mmss (3-4 digits), or bare seconds (1-2 digits). A trailing
// 3-digit part is milliseconds for sub-second precision: mm-ss-mmm (e.g.
// "00-04-289" = 4.289s) or hh-mm-ss-mmm. A 1-2 digit final part is still
// hh-mm-ss (e.g. "1-02-05" = 3725s), so existing names are unaffected.
export function parseTimestampName(filename) {
  if (!filename || typeof filename !== "string") return null;
  // Strip the directory prefix, then take the leading stem (everything before the first
  // dot). The timecode always leads the name, so this drops single AND stacked/embedded
  // extensions that would otherwise hide it — e.g. a Flow round-trip like
  // "0-00.png_213412342134.jpeg.mp4" → "0-00".
  let base = filename.split(/[\\/]/).pop().split(".")[0].trim();

  // Flow projects downloaded directly append a download datetime stamp after the
  // timecode, e.g. "10-24_202608272310" → keep the "10-24". A trailing separator
  // followed by 8+ digits is a datestamp, never a real timecode component (ss,
  // hh/mm are ≤2 digits; bare mmss has no leading separator), so drop it.
  base = base.replace(/[-_]\d{8,}$/, "");

  let m;
  // hh-mm-ss-mmm (four parts; trailing 3-digit part is milliseconds)
  if ((m = base.match(/^(\d+)[-_](\d{1,2})[-_](\d{1,2})[-_](\d{3})$/))) {
    return (+m[1]) * 3600 + (+m[2]) * 60 + (+m[3]) + (+m[4]) / 1000;
  }
  // mm-ss-mmm (trailing 3-digit part is milliseconds, e.g. 00-04-289 = 4.289s)
  if ((m = base.match(/^(\d+)[-_](\d{1,2})[-_](\d{3})$/))) {
    return (+m[1]) * 60 + (+m[2]) + (+m[3]) / 1000;
  }
  // hh-mm-ss (1-2 digit final part = seconds, not ms)
  if ((m = base.match(/^(\d+)[-_](\d{1,2})[-_](\d{1,2})$/))) {
    return (+m[1]) * 3600 + (+m[2]) * 60 + (+m[3]);
  }
  // mm-ss
  if ((m = base.match(/^(\d+)[-_](\d{1,2})$/))) {
    return (+m[1]) * 60 + (+m[2]);
  }
  // bare digits
  if ((m = base.match(/^\d+$/))) {
    if (base.length >= 3) {
      const secs = +base.slice(-2);
      const mins = +base.slice(0, -2);
      return mins * 60 + secs;
    }
    return +base; // 1-2 digits → plain seconds
  }
  return null;
}
