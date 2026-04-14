export const DAYS_OF_WEEK = [
  { value: "MON", label: "Mon" },
  { value: "TUE", label: "Tue" },
  { value: "WED", label: "Wed" },
  { value: "THU", label: "Thu" },
  { value: "FRI", label: "Fri" },
  { value: "SAT", label: "Sat" },
  { value: "SUN", label: "Sun" },
];

const WORKDAYS = new Set(["MON", "TUE", "WED", "THU", "FRI"]);

export const TIMEZONES = [
  "UTC",
  "US/Eastern",
  "US/Central",
  "US/Mountain",
  "US/Pacific",
  "Europe/London",
  "Europe/Berlin",
  "Europe/Paris",
  "Europe/Stockholm",
  "Asia/Tokyo",
  "Asia/Shanghai",
  "Asia/Kolkata",
  "Asia/Dubai",
  "Australia/Sydney",
  "Pacific/Auckland",
];

export function detectTimezone() {
  try {
    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
    if (TIMEZONES.includes(tz)) return tz;
  } catch (err) {
    console.error("Timezone detection failed:", err);
  }
  return "UTC";
}

export const scheduleDefaults = () => ({
  frequency: "daily",
  interval: "1",
  time: "09:00",
  selectedDays: ["MON"],
  dayOfMonth: "1",
});

/** Try to parse an existing schedule_expression back into form state. */
export function parseScheduleExpression(expr) {
  const d = scheduleDefaults();
  if (!expr) return d;

  // rate(N minutes|hours|days)
  const rateMatch = expr.match(/^rate\((\d+)\s+(minute|hour|day)s?\)$/i);
  if (rateMatch) {
    const n = rateMatch[1];
    const unit = rateMatch[2].toLowerCase();
    if (unit === "minute") return { ...d, frequency: "minutes", interval: n };
    if (unit === "hour") return { ...d, frequency: "hours", interval: n };
    if (unit === "day") return { ...d, frequency: "days", interval: n };
  }

  // cron(min hour dom month dow year)
  const cronMatch = expr.match(/^cron\((\d+)\s+(\S+)\s+(\S+)\s+\*\s+(\S+)\s+\*\)$/);
  if (cronMatch) {
    const [, min, hourField, dom, dow] = cronMatch;
    // Every N days: cron(M H */N * ? *)
    const everyNMatch = dom.match(/^\*\/(\d+)$/);
    if (everyNMatch && dow === "?") {
      const time = `${hourField.padStart(2, "0")}:${min.padStart(2, "0")}`;
      return { ...d, frequency: "days", interval: everyNMatch[1], time };
    }
    // Daily
    if (dom === "*" && dow === "?") {
      const time = `${hourField.padStart(2, "0")}:${min.padStart(2, "0")}`;
      return { ...d, frequency: "daily", time };
    }
    // Monthly
    if (dow === "?" && dom !== "?" && dom !== "*") {
      const time = `${hourField.padStart(2, "0")}:${min.padStart(2, "0")}`;
      return { ...d, frequency: "monthly", time, dayOfMonth: dom };
    }
    // Weekly / Workdays
    if (dom === "?" && dow !== "?") {
      const time = `${hourField.padStart(2, "0")}:${min.padStart(2, "0")}`;
      const days = dow.split(",");
      const isWorkdays = days.length === 5 && days.every((day) => WORKDAYS.has(day));
      if (dow === "MON-FRI" || isWorkdays) {
        return { ...d, frequency: "workdays", time };
      }
      return { ...d, frequency: "weekly", time, selectedDays: days };
    }
  }

  // Fallback — daily
  return d;
}

/** Build schedule_expression from form state. */
export function buildScheduleExpression({ frequency, interval, time, selectedDays, dayOfMonth }) {
  const [h, m] = (time || "09:00").split(":").map(Number);
  switch (frequency) {
    case "minutes": {
      const n = Math.max(1, parseInt(interval, 10) || 1);
      return `rate(${n} ${n === 1 ? "minute" : "minutes"})`;
    }
    case "hours": {
      const n = Math.max(1, parseInt(interval, 10) || 1);
      return `rate(${n} ${n === 1 ? "hour" : "hours"})`;
    }
    case "days": {
      const n = Math.max(1, parseInt(interval, 10) || 1);
      return `cron(${m} ${h} */${n} * ? *)`;
    }
    case "daily":
      return `cron(${m} ${h} * * ? *)`;
    case "workdays":
      return `cron(${m} ${h} ? * MON-FRI *)`;
    case "weekly": {
      const dow = selectedDays.length > 0 ? selectedDays.join(",") : "MON";
      return `cron(${m} ${h} ? * ${dow} *)`;
    }
    case "monthly":
      return `cron(${m} ${h} ${dayOfMonth} * ? *)`;
    default:
      return "";
  }
}
