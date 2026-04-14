import { useReducer, useEffect } from "react";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { createScheduledTask, updateScheduledTask } from "@/services/scheduledTasksService";
import {
  DAYS_OF_WEEK,
  TIMEZONES,
  detectTimezone,
  scheduleDefaults,
  parseScheduleExpression,
  buildScheduleExpression,
} from "../utils/scheduleExpression";

const initialState = {
  name: "",
  prompt: "",
  timezone: detectTimezone(),
  saving: false,
  frequency: "daily",
  interval: "1",
  time: "09:00",
  selectedDays: ["MON"],
  dayOfMonth: "1",
};

function formReducer(state, action) {
  switch (action.type) {
    case "SET_FIELD":
      return { ...state, [action.field]: action.value };
    case "LOAD":
      return { ...state, ...action.payload, saving: false };
    case "RESET":
      return { ...initialState, timezone: detectTimezone(), ...scheduleDefaults() };
    case "TOGGLE_DAY": {
      const days = state.selectedDays.includes(action.day)
        ? state.selectedDays.filter((d) => d !== action.day)
        : [...state.selectedDays, action.day];
      return { ...state, selectedDays: days };
    }
    default:
      return state;
  }
}

export function TaskForm({ open, onClose, onSave, editJob }) {
  const [s, dispatch] = useReducer(formReducer, initialState);
  const set = (field, value) => dispatch({ type: "SET_FIELD", field, value });

  useEffect(() => {
    if (editJob) {
      const parsed = parseScheduleExpression(editJob.schedule_expression);
      dispatch({
        type: "LOAD",
        payload: {
          name: editJob.name || "",
          prompt: editJob.prompt || "",
          timezone: editJob.timezone || "UTC",
          ...parsed,
        },
      });
    } else {
      dispatch({ type: "RESET" });
    }
  }, [editJob, open]);

  const schedule = buildScheduleExpression({
    frequency: s.frequency,
    interval: s.interval,
    time: s.time,
    selectedDays: s.selectedDays,
    dayOfMonth: s.dayOfMonth,
  });

  const handleSubmit = async () => {
    if (!s.name.trim() || !s.prompt.trim() || !schedule.trim()) {
      toast.error("Name, prompt, and schedule are required");
      return;
    }
    set("saving", true);
    try {
      if (editJob) {
        await updateScheduledTask(editJob.job_id, {
          name: s.name,
          prompt: s.prompt,
          schedule_expression: schedule,
          timezone: s.timezone,
        });
        toast.success("Scheduled task updated");
      } else {
        await createScheduledTask({
          name: s.name,
          prompt: s.prompt,
          schedule_expression: schedule,
          timezone: s.timezone,
        });
        toast.success("Scheduled task created");
      }
      onSave();
      onClose();
    } catch (e) {
      toast.error(e.message || "Failed to save scheduled task");
    } finally {
      set("saving", false);
    }
  };

  const showInterval = s.frequency === "hours" || s.frequency === "days";
  const showTime = s.frequency !== "hours";
  const showDays = s.frequency === "weekly";
  const showDayOfMonth = s.frequency === "monthly";

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{editJob ? "Edit Scheduled Task" : "New Scheduled Task"}</DialogTitle>
          <DialogDescription>
            Schedule a prompt to run automatically on a recurring basis.
          </DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-3">
          <div>
            <Label>Name</Label>
            <Input
              value={s.name}
              onChange={(e) => set("name", e.target.value)}
              placeholder="Daily report"
            />
          </div>

          <div>
            <Label>Repeat</Label>
            <Select value={s.frequency} onValueChange={(v) => set("frequency", v)}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="hours">Every N hours</SelectItem>
                <SelectItem value="days">Every N days</SelectItem>
                <SelectItem value="daily">Daily</SelectItem>
                <SelectItem value="workdays">Workdays (Mon–Fri)</SelectItem>
                <SelectItem value="weekly">Specific days of the week</SelectItem>
                <SelectItem value="monthly">Monthly</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {showInterval && (
            <div>
              <Label>Every</Label>
              <div className="flex items-center gap-2">
                <Input
                  type="number"
                  min="1"
                  className="w-20"
                  value={s.interval}
                  onChange={(e) => set("interval", e.target.value)}
                />
                <span className="text-sm text-muted-foreground">
                  {s.frequency === "hours" ? "hour(s)" : "day(s)"}
                </span>
              </div>
            </div>
          )}

          {showDays && (
            <div>
              <Label>Days</Label>
              <div className="flex gap-1 flex-wrap">
                {DAYS_OF_WEEK.map((d) => (
                  <Button
                    key={d.value}
                    type="button"
                    size="sm"
                    variant={s.selectedDays.includes(d.value) ? "default" : "outline"}
                    className="h-8 px-3 text-xs"
                    onClick={() => dispatch({ type: "TOGGLE_DAY", day: d.value })}
                  >
                    {d.label}
                  </Button>
                ))}
              </div>
            </div>
          )}

          {showDayOfMonth && (
            <div>
              <Label>Day of month</Label>
              <Input
                type="number"
                min="1"
                max="28"
                className="w-20"
                value={s.dayOfMonth}
                onChange={(e) => set("dayOfMonth", e.target.value)}
              />
            </div>
          )}

          {showTime && (
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label>Time</Label>
                <Input type="time" value={s.time} onChange={(e) => set("time", e.target.value)} />
              </div>
              <div>
                <Label>Timezone</Label>
                <Select value={s.timezone} onValueChange={(v) => set("timezone", v)}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {TIMEZONES.map((tz) => (
                      <SelectItem key={tz} value={tz}>
                        {tz}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
          )}

          <div>
            <Label>Prompt</Label>
            <Textarea
              value={s.prompt}
              onChange={(e) => set("prompt", e.target.value)}
              placeholder="Generate a daily summary of..."
              rows={5}
            />
          </div>

          {schedule && (
            <p className="text-xs text-muted-foreground">
              Expression: <code className="bg-muted px-1 py-0.5 rounded">{schedule}</code>
            </p>
          )}
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={handleSubmit} disabled={s.saving}>
            {s.saving && <Loader2 className="animate-spin mr-2" size={14} />}
            {editJob ? "Update" : "Create"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
