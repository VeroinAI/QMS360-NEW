/** Picker values are local wall-clock ISO strings, never UTC-converted dates. */
export function pickerTimeBounds(day: string, min?: string | number, max?: string | number) {
  const minimum = String(min ?? "");
  const maximum = String(max ?? "");
  return {
    min: minimum.startsWith(`${day}T`) ? minimum.slice(11, 16) : undefined,
    max: maximum.startsWith(`${day}T`) ? maximum.slice(11, 16) : undefined,
  };
}

export function calendarPickerValue(day: Date, withTime: boolean, current?: string | null, min?: string | number, max?: string | number): string {
  const iso = `${day.getFullYear()}-${String(day.getMonth() + 1).padStart(2, "0")}-${String(day.getDate()).padStart(2, "0")}`;
  if (!withTime) return iso;
  const bounds = pickerTimeBounds(iso, min, max);
  let time = current?.split("T")[1]?.slice(0, 5) || "00:00";
  if (bounds.min && time < bounds.min) time = bounds.min;
  if (bounds.max && time > bounds.max) time = bounds.max;
  return `${iso}T${time}`;
}
