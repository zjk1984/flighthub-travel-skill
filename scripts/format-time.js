/** Format a date in Asia/Shanghai (YYYY-MM-DD HH:mm:ss). */
function formatShanghaiTime(date = new Date()) {
  return new Intl.DateTimeFormat("sv-SE", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).format(date);
}

module.exports = { formatShanghaiTime };
