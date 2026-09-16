import { useEffect, useRef, useState } from "react";
import { Link, Route, Switch, useLocation, useParams } from "wouter";
import { useQueryClient } from "@tanstack/react-query";
import {
  useCloseCorrectiveActionReport,
  useConfirmAuditEvidence,
  useCreateAuditEvidenceIntent,
  useCreateAuditFinding,
  useCreateAuditPlan,
  useCreateAuditSchedule,
  useCreateFindingCars,
  useDeleteAuditPlan,
  useDeleteAuditSchedule,
  useGetAudit,
  useGetAuditDashboard,
  useGetAuditPlan,
  useGetAuditPlanOptions,
  useGetAuditProgramme,
  getGetAuditProgrammeQueryKey,
  listAuditSchedules,
  listPlatformProjects,
  useGetGeneratedAuditReport,
  useListAuditEvidence,
  useListAuditFindings,
  useListAuditPlans,
  useListAuditSchedules,
  useListAuditProgrammes,
  useCreateAuditProgramme,
  useSubmitAuditProgramme,
  useReviewAuditProgramme,
  useListAudits,
  useListCorrectiveActionReports,
  useListPlatformProjects,
  useCancelCarExtension,
  useRequestCarExtension,
  useReviewAuditSchedule,
  useReviewCarExtension,
  useReviewCorrectiveActionReport,
  useShareAuditPlan,
  useSubmitCorrectiveActionReport,
  useUpdateAuditChecklist,
  useUpdateAuditClosingMeeting,
  useUpdateAuditFinding,
  useUpdateAuditOpeningMeeting,
  useUpdateAuditPlan,
  useUpdateCorrectiveActionReport,
  useUpdateAuditSchedule,
} from "@workspace/api-client-react";
import type {
  AuditFinding,
  AuditPlan,
  AuditSchedule,
  ChecklistItem,
  CorrectiveActionReport,
  EvidenceFile,
  MeetingMinutes,
} from "@workspace/api-client-react";
import {
  AlertTriangle, ArrowLeft, BarChart3, CalendarDays, CheckCircle2, ChevronDown, ClipboardCheck,
  Download, Eye, FileText, FolderOpen, Pencil, Plus, Printer, Search, Share2, ShieldCheck,
  Trash2, Upload, XCircle,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { useGetAuditEscalations } from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { DropdownMenu, DropdownMenuCheckboxItem, DropdownMenuContent, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Progress } from "@/components/ui/progress";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import * as XLSX from "xlsx";
import { useLov, withLegacyOption } from "@/lib/use-lov";
import { useFieldAccess } from "@/lib/use-field-access";
import { useFieldControls } from "@/lib/field-controls";
import {
  cacheAuditPlanContext,
  queueAuditPlan,
  readAuditPlanContext,
  syncQueuedAuditPlans,
  type AuditPlanOfflineContext,
} from "@/lib/pwa";

const PAGE_SIZE = 10;
const date = (value?: string | null) => value ? new Date(value).toLocaleDateString() : "—";
const errorText = (error: unknown) => error instanceof Error ? error.message : "Something went wrong.";
const fileSize = (bytes: number) => bytes < 1024 * 1024 ? `${Math.max(1, Math.round(bytes / 1024))} KB` : `${(bytes / 1024 / 1024).toFixed(1)} MB`;
type ProgrammeRange = { fromDate: string; toDate: string };
const PROCESS_AUDIT_TYPE = "Quality Internal Process Audit";
const PRODUCT_AUDIT_TYPE = "Quality Internal Product Audit";
const scheduleImportHeaders = [
  "Audit Type", "Audit Category", "Department / Project", "Location", "Audit Title",
  "Process / Product Owner", "From Date", "To Date", "Remarks",
];
const normalizeHeader = (value: unknown) => String(value ?? "").trim().toLowerCase().replace(/[^a-z0-9]/g, "");
const scheduleHeaderAliases: Record<string, string> = {
  audittype: "auditTypes", audittypevalue: "auditTypes", auditcategory: "auditCategory",
  departmentproject: "departmentProject", project: "departmentProject", location: "location",
  audittitle: "title", processeeproductowner: "processProductOwner", processproductowner: "processProductOwner",
  fromdate: "plannedStartDate", startdate: "plannedStartDate", todate: "plannedEndDate", enddate: "plannedEndDate",
  remarks: "remarks",
};
const scheduleDate = (value: unknown) => {
  if (value instanceof Date) {
    const year = value.getFullYear();
    const month = value.getMonth() + 1;
    const day = value.getDate();
    return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
  }
  if (typeof value === "number") {
    const parsed = XLSX.SSF.parse_date_code(value);
    return parsed ? `${parsed.y}-${String(parsed.m).padStart(2, "0")}-${String(parsed.d).padStart(2, "0")}` : "";
  }
  const candidate = String(value ?? "").trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(candidate)) return "";
  const [year, month, day] = candidate.split("-").map(Number);
  const parsed = new Date(Date.UTC(year, month - 1, day));
  return parsed.getUTCFullYear() === year && parsed.getUTCMonth() === month - 1 && parsed.getUTCDate() === day ? candidate : "";
};
const programmeTimeline = (year: number) => {
  const isLeap = (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
  const days = [31, isLeap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  const labels = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
  const months = labels.map((label, index) => ({ label, days: days[index], weeks: Math.ceil(days[index] / 7) }));
  const monthStartSlots = months.map((_, index) => months.slice(0, index).reduce((sum, month) => sum + month.weeks, 0));
  const totalSlots = months.reduce((sum, month) => sum + month.weeks, 0);
  return { months, monthStartSlots, totalSlots };
};
const programmeTimelinePosition = (
  value: string | null | undefined,
  year: number,
  end: boolean,
  timeline: ReturnType<typeof programmeTimeline>,
) => {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value?.slice(0, 10) ?? "");
  if (!match) return 0;
  const parsed = { year: Number(match[1]), month: Number(match[2]) - 1, day: Number(match[3]) };
  if (parsed.year < year) return 0;
  if (parsed.year > year) return timeline.totalSlots;
  const month = timeline.months[parsed.month];
  if (!month) return 0;
  const dayFraction = (parsed.day - (end ? 0 : 1)) / month.days;
  return timeline.monthStartSlots[parsed.month] + dayFraction * month.weeks;
};
const stableScheduleId = async (parentId: string, row: Record<string, unknown>) => {
  const input = new TextEncoder().encode(`${parentId}\n${JSON.stringify(row)}`);
  const bytes = new Uint8Array(await crypto.subtle.digest("SHA-256", input));
  bytes[6] = (bytes[6] & 0x0f) | 0x50;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = Array.from(bytes.slice(0, 16), byte => byte.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
};
const workbookDownload = (rows: Record<string, unknown>[], fileName: string, range?: ProgrammeRange) => {
  const workbook = XLSX.utils.book_new();
  const sheet = XLSX.utils.json_to_sheet(rows, { header: scheduleImportHeaders });
  XLSX.utils.book_append_sheet(workbook, sheet, "Audit Schedules");
  const instructions = [
    ["Audit Schedule Import Instructions"],
    ["Template columns", scheduleImportHeaders.join(", ")],
    ["Mandatory columns", "Audit Type, Audit Category, Department / Project, Audit Title, Process / Product Owner, From Date, To Date"],
    ["Date format", "YYYY-MM-DD"],
    ["Parent range", range ? `${range.fromDate} through ${range.toDate}` : "No parent range"],
    ["Department / Project", `For ${PROCESS_AUDIT_TYPE}, use an active department value or exact name. For ${PRODUCT_AUDIT_TYPE}, use an active project code or exact project name.`],
  ];
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet(instructions), "Instructions");
  XLSX.writeFile(workbook, fileName);
};
const programmeLogoJpegBase64 = "/9j/4AAQSkZJRgABAQIASwBLAAD/2wBDAAcFBQYFBAcGBgYIBwcICxILCwoKCxYPEA0SGhYbGhkWGRgcICgiHB4mHhgZIzAkJiorLS4tGyIyNTEsNSgsLSz/2wBDAQcICAsJCxULCxUsHRkdLCwsLCwsLCwsLCwsLCwsLCwsLCwsLCwsLCwsLCwsLCwsLCwsLCwsLCwsLCwsLCwsLCz/wAARCAA7ALQDASIAAhEBAxEB/8QAHAAAAgMBAQEBAAAAAAAAAAAAAAcFBggEAQMC/8QAOxAAAQMEAAQEBAQEAwkAAAAAAQIDBAAFBhEHEiExE0FRYRQicYEjMkKRFaGxwQgkUhc1NnN0srPR4f/EABkBAQEBAQEBAAAAAAAAAAAAAAADBAIBBf/EACERAAICAgIDAAMAAAAAAAAAAAABAgMEERIhEzFBIlGB/9oADAMBAAIRAxEAPwDSNFFeE6oD2ioC3Zhbbtk0iywHDIditlx5xP5EdQOXfmetVPizxElYmwxb7ZpM6UkrLh6+GnetgepP9KpCqU5KCXZ0otvQy6Ky3b+LOXwpzb7l3dloSdlp0ApUPToK0PieSt5Tisa7stlBdBCm9/lUDoiq3Y06ltnUq3EnaKr+L5lbMpaeERZRIjLKHmF9FIIOvuKsFZ2mnpnDWvYUUUss8vt7uWZRcWxm4uQpTMdyTIcRr/TtKT0+n714eDNopdW7LJ1y4KTbqJK0XSHGdbdc6cyXUdN/XsfvUzw0uc274RFmXCQuTIX+ZxetnoKAtlFLnJJ1+vfEtrGbTd3LQwxD+KedbSCpezrXX7V+FWrMLVfIDsLLDd43iaksyihOk78tDv3oBk0Um15bfRC4hLFze5ra+UxD0/BHiEaHT0q3Ytn9kXilsVc79GM5UdBe8RYCufXXfvQF2opecPcqlScFu15usxcsRJDxStWvyJGwBVPxzNsoi3mx3i83Bx603x91oMkAJa+bQI+9APOiq9ktlul38BdvyGTaEtg8/gpSQvfmdjypdYpLye95+uLAyibOs1uWPiX3UpCXSP0jQ86Ac1FFFAFFFFAFKzjNnT9ghNWe2veHMlpKnVp7tt9unuf7U06yLm0+Vcc0urkt4urbkuNJJ8kpUQB+1bMOpWT2/SLVR5S7LbwOvbNuzZ6NJcCBPZ8NJUe6wdj9+tWrjvir0uJFyGMkr+GT4L4A7I2SFfYk/vSNadWy6l1tRQtBCkqB6g1ovCcquub4uiM9ACDylp+U4jmbWNa2B5k1ryIuqxXR/pSacXyRn61WidepyIdujLkPrPRKR29z6CtOYnaGsD4eIZmPJBjNqffWT0Cj1P8A6rotllseC2nliMIQo/q1+I8r0HmfpVE4wPXqTgzc15RhRnH0oVEA+Yg71zH7dqjO55MlBdLZw5c3r4KCBkc605Mq8wHVNPF5TugeigVElJ9q1Vi2Qxcnx+Pc4qgUupHOkH8ivNJrH1O7/D5cllq721StpSUPpHpv5T/QVozak6+a+HdsVrY6Fq5W1K9Buk/ieOZVdMlvWUNyUWp+U+ppAksFSi2D016DtTefeDEZ14jYbSVa+g3UVimRNZVjka7sMqZbkc2kKOyNKKf7V8YyipYsl+sLmaWJ5l2WxcIa32nWmyG1ukbISPI9SNe1deFZnc8Yxli2PYldHltd1pRoHoB/argzxLtyrVerg8ythq0P/Dr5lDbitkDX7VEHjDyt+MvF7kmOBzF0j5QPWgOKfNu1sz2FmTVhlyIU63JZfaQnbjB3vqPXtUHc7avJMstS8cx24wGm5IelSHwpAV8wPYn60x5HEK3NyMfQw2qS3fV8jTiFDSDvXX71aZDwjxXXiNhtBWR66G6ASq7LczD4kJECRuZIKmByH8UeIo/L61dMRwSwrw61qn2KMZZjI8UuNfNza6796jI/GVMpnxmMYuTrJJAcQAUnXvUvL4nW2PhKckaYW+yXQytpKgFIUfI/SgF6xbrzG4WyrDFt0ht+53VTWg2RyNbG1H27VMZHw4yM4O3CF0jyW7UgORmWo/KvmSOwPrVpzDiZExBUBMiC6/8AGs+MnkUByj3qUu2ZwrbhIyZCDJilCFhKFDZCjrvQCwu2SZXNwSz2du23BlxaPDnPoaJc5UnWh9R1q1Ynk8GzRIdmt+LXaO0VJQXFsa2SdFSj/OpO6cS4NtsdqnJhPSX7o2HWYrZBc5dd657JxSYud9i2uZZ5drdlHlaVI6BR9BQF9ooooAooooArHeUf8XXj/rXv/IqtiVnnjXhybNem7xCYCIc3Yc5R0S7skk/Xv+9b8GajNxf0tS9PQrk6KhvtvrWprTeoce2wbHjaGZUhthBUEn8NhJH5lkeft3NZYpn4PxBt2DYM8luKuTdZb6lAa5UaAAG1ensK25lbnFa7LWR2uh1mLDtCRcrtLD0pPZ1zoEk+SE+Xp060nONGVXK4vRrWqA9Dt3R9CnU6U8eoB15Aeneq3B4l3gZtGv1xeVKQ2vqx+hKD0ISPI686eGUWq3cRuHqnoZQ4XGvHiukdUqHl7ehrGq3jTjKxbJJeNpyMuU4P8PcdZvN4k6/DSwhv7lW/7UoShQcLfKecHl5fPdad4T4i5iuJalACZNUH3Rr8g18qft/etmbNKrX7K2y/EuFx/wB1S/8Akr/7TSn4ZwcyewG3rtN1tseES54aHmVKWPnVvZHvum88hLrC21jaFgpI9jXBY7Xb7HbWrZbUBqMzzcjfNza2dn+Zr4ZjEBp5GJ3pMtaVkZEx8QpI0k/n2fpun3d5EEY7NPjM+D8Mv9Q5dcprlGF4+1AuEVcFBj3FzxZCVqJCl779e1Rn+yjE+xt7pR/oMhfL+26AU+PFSInDounlT/EXSkq7BPiD/wC0/Z77TlrlpQ6hZ8FfQKB/SaibrguOXaLCiSoCSzBSRHbQso5B7aNfiy4TjtlmOu26OUPOtKZXt5SvlPcaJ9hQEVwhdZRw1gBbqEkLd7qA/WaWN55Tw2yhTRBYVf8A8Mjtrr2pqp4WYgn5EwVgEn5RIXr36bqSewrHHMeTYVQW0W9Kw74SVFO1epPc0BRMzhM3LPsJhSUc7MiKW1j1BGqrV0kP47hWTYNcHeZUJaH4SldPEaKwTr+v707JGM2uZdIFxejc0m3Dljr5j8g+nnXLkGDWDJ5bUm6wRIdaTyJUFlJ16dO9ALrGXG05vhBeUlKP4GQkq6DfWpTKb7c4uWWZq52e1TGXp/hw1odKnUDmHza8jrVXCfgmPXK3Q4Uq3pW1BTyMELIU2n0Ch1rnteAYxZ7o3OjQ/wDNsH5FuvKWUE+mz0oC1UUUUAUUUUAVw3izwr5bHrfPZS9HeTpST5e49DXdRRPXaBni4cGJ1vzKDDQpcm0SngFSEjq2nqSFfYd/eujjdjX8MctMmDG8K2tMGOEoT8ragSev13/Kn9XwlRI81hUeUyh9lY0pC07B+1bI5c+SlLvRVWvabMYJSpawlCSpSjoADZNaj4YWqXZuG8GPNbUl4hbvhK7pCiSBXNjOLWONkdyeZtcZDjDoDauT8n0q9jtVMrI8iUUj2yfLoUmC8JUou7l/v7WnS+p1iH0IR8xIKvU+1NwDVCa9rHOyVj3Im5OXbPlLLiYbxa6uBBKPrrpSost1ft1zs015m8LeWlz+JJMFXKlRTvSdJ7c9NyipnIrpl8evGSXFEty/R7QW2/h0NQVaUr9WwUnz1XRbMrlW/KHEPLvs20qjb55EFXMl3m7DSR01TJrwgFJB6g0ArbRf7ki9NXq5xbi7HcTLZYKYylFKS4ktgpA6dAe9cFqu0q33C03LwbuqS86s3FBt55UpVsnl0nfcJ86bkVhqNHDTLaW20k6SkaAr7UAvLAmVIv8AAmfCym2HbhPdHitqSQhSU8pIPbejrdc+cypaspcix2S+lqKxJKWW+Z3SZCebWupGt9KZdVmzxGBnN7leEnxyG0c/ny8oOvpQEJkmYOTF25q2ovUVsyP8041BWFBvlPbaT56qDsuU32Lcba7McvkhlbryZbbsJRCWxvwyNJ3vtum7RQCzvOUSY7vxlok32Q+HkLMJ6Erwy2VaUB8uxob11qPvSpl7vs+fCg3AR1yrYlPiMLQTyOK5zo+QBGzTX8Br4zx/DT4vJyc+uut71uvrQBRRRQBRRRQH/9k=";
const ascii85Encode = (bytes: Uint8Array) => {
  let encoded = "";
  for (let offset = 0; offset < bytes.length; offset += 4) {
    const remaining = Math.min(4, bytes.length - offset);
    let value = 0;
    for (let index = 0; index < 4; index += 1) value = value * 256 + (index < remaining ? bytes[offset + index] : 0);
    if (remaining === 4 && value === 0) {
      encoded += "z";
      continue;
    }
    const chars = Array(5);
    for (let index = 4; index >= 0; index -= 1) {
      chars[index] = String.fromCharCode((value % 85) + 33);
      value = Math.floor(value / 85);
    }
    encoded += chars.join("").slice(0, remaining + 1);
  }
  return `${encoded}~>`;
};
const programmePdfDownload = (rows: AuditSchedule[], fileName: string, auditTitle: string) => {
  const year = rows[0]?.year ?? new Date().getFullYear();
  const timeline = programmeTimeline(year);
  const fixedHeaders = [
    "Business Category", "Department / Project", "Process Owner", "Audit Number / Site Visit No",
    "QA/QC Reference", "QA/QC Scope", "QA/QC Clauses",
  ];
  const pageWidth = 1191;
  const pageHeight = 842;
  const margin = 18;
  const titleHeight = 44;
  const headerHeight = 42;
  const rowHeight = 34;
  const rowsPerPage = 20;
  const fixedWidths = [76, 92, 80, 90, 78, 116, 88];
  const remarksWidth = 94;
  const fixedWidth = fixedWidths.reduce((sum, width) => sum + width, 0);
  const timelineWidth = pageWidth - margin * 2 - fixedWidth - remarksWidth;
  const weekWidth = timelineWidth / timeline.totalSlots;
  const escapePdf = (value: string) => value
    .normalize("NFKD").replace(/[^\x20-\x7E]/g, "")
    .replace(/\\/g, "\\\\").replace(/\(/g, "\\(").replace(/\)/g, "\\)");
  const fit = (value: unknown, width: number, size: number) => {
    const text = String(value ?? "").trim();
    const limit = Math.max(1, Math.floor((width - 5) / (size * 0.52)));
    return escapePdf(text.length > limit ? `${text.slice(0, Math.max(1, limit - 3))}...` : text);
  };
  const text = (value: unknown, x: number, y: number, size = 5.5, bold = false) =>
    `0 0 0 rg BT /${bold ? "F2" : "F1"} ${size} Tf ${x.toFixed(2)} ${y.toFixed(2)} Td (${fit(value, 1000, size)}) Tj ET\n`;
  const centeredText = (value: unknown, x: number, y: number, width: number, size = 5, bold = false) => {
    const raw = escapePdf(String(value ?? "").trim());
    const limit = Math.max(1, Math.floor(width / (size * 0.52)));
    const fitted = raw.slice(0, limit);
    const estimatedWidth = fitted.length * size * 0.52;
    return text(fitted, x + Math.max(2, (width - estimatedWidth) / 2), y, size, bold);
  };
  const rect = (x: number, y: number, width: number, height: number, fill?: [number, number, number]) =>
    `${fill ? `${fill.join(" ")} rg ${x.toFixed(2)} ${y.toFixed(2)} ${width.toFixed(2)} ${height.toFixed(2)} re f\n` : ""}0.45 G 0.35 w ${x.toFixed(2)} ${y.toFixed(2)} ${width.toFixed(2)} ${height.toFixed(2)} re S\n`;
  const pages: string[] = [];
  const pageCount = Math.max(1, Math.ceil(rows.length / rowsPerPage));
  for (let pageIndex = 0; pageIndex < pageCount; pageIndex += 1) {
    let content = "";
    const tableTop = pageHeight - margin - titleHeight;
    const headingLeftWidth = 128;
    const headingRightWidth = 84;
    const headingCenterWidth = pageWidth - margin * 2 - headingLeftWidth - headingRightWidth;
    content += rect(margin, tableTop, headingLeftWidth, titleHeight);
    content += rect(margin + headingLeftWidth, tableTop, headingCenterWidth, titleHeight);
    content += rect(margin + headingLeftWidth + headingCenterWidth, tableTop, headingRightWidth, titleHeight);
    const logoHeight = 36;
    const logoWidth = logoHeight * (180 / 59);
    content += `q ${logoWidth.toFixed(2)} 0 0 ${logoHeight.toFixed(2)} ${(margin + (headingLeftWidth - logoWidth) / 2).toFixed(2)} ${(tableTop + (titleHeight - logoHeight) / 2).toFixed(2)} cm /Logo Do Q\n`;
    content += centeredText(auditTitle, margin + headingLeftWidth, tableTop + 20, headingCenterWidth, 10, true);
    if (pageCount > 1) content += centeredText(`Page ${pageIndex + 1} of ${pageCount}`, margin + headingLeftWidth + headingCenterWidth, tableTop + 8, headingRightWidth, 4.5);
    const headerBottom = tableTop - headerHeight;
    let x = margin;
    fixedHeaders.forEach((header, index) => {
      content += rect(x, headerBottom, fixedWidths[index], headerHeight, [0.91, 0.89, 0.95]);
      const words = header.split(" ");
      const midpoint = Math.ceil(words.length / 2);
      content += centeredText(words.slice(0, midpoint).join(" "), x, headerBottom + 24, fixedWidths[index], 5.2, true);
      if (words.length > 1) content += centeredText(words.slice(midpoint).join(" "), x, headerBottom + 13, fixedWidths[index], 5.2, true);
      x += fixedWidths[index];
    });
    const timelineX = x;
    timeline.months.forEach((month, monthIndex) => {
      const monthX = timelineX + timeline.monthStartSlots[monthIndex] * weekWidth;
      const monthWidth = month.weeks * weekWidth;
      content += rect(monthX, tableTop - 21, monthWidth, 21, [0.91, 0.89, 0.95]);
      content += centeredText(month.label, monthX, tableTop - 14, monthWidth, 4.7, true);
    });
    Array.from({ length: timeline.totalSlots }, (_, week) => {
      const weekX = timelineX + week * weekWidth;
      content += rect(weekX, headerBottom, weekWidth, 21, [0.96, 0.95, 0.98]);
      content += centeredText(String(week + 1), weekX, headerBottom + 7, weekWidth, 3.8, false);
    });
    const remarksX = timelineX + timelineWidth;
    content += rect(remarksX, headerBottom, remarksWidth, headerHeight, [0.91, 0.89, 0.95]);
    content += centeredText("Remarks", remarksX, headerBottom + 18, remarksWidth, 5.4, true);
    rows.slice(pageIndex * rowsPerPage, (pageIndex + 1) * rowsPerPage).forEach((item, rowIndex) => {
      const y = headerBottom - (rowIndex + 1) * rowHeight;
      const values = [
        item.auditCategory, item.departmentProject, item.processProductOwner, item.auditNumber,
        item.qaqcReference, item.qaqcScope, item.qaqcClauses,
      ];
      let cellX = margin;
      values.forEach((value, index) => {
        content += rect(cellX, y, fixedWidths[index], rowHeight, rowIndex % 2 ? [0.98, 0.98, 0.99] : undefined);
        content += text(fit(value, fixedWidths[index], 5), cellX + 3, y + rowHeight / 2 - 2, 5);
        cellX += fixedWidths[index];
      });
      Array.from({ length: timeline.totalSlots }, (_, week) => {
        content += rect(timelineX + week * weekWidth, y, weekWidth, rowHeight, rowIndex % 2 ? [0.98, 0.98, 0.99] : undefined);
      });
      const start = Math.max(0, Math.min(timeline.totalSlots, programmeTimelinePosition(item.plannedStartDate, year, false, timeline)));
      const end = Math.max(0, Math.min(timeline.totalSlots, programmeTimelinePosition(item.plannedEndDate, year, true, timeline)));
      const barWidth = Math.max(0, end - start) * weekWidth;
      if (barWidth > 0) {
        content += `0.10 0.32 0.58 rg ${(timelineX + start * weekWidth).toFixed(2)} ${(y + 8).toFixed(2)} ${Math.max(2, barWidth).toFixed(2)} ${(rowHeight - 16).toFixed(2)} re f\n`;
      }
      content += rect(remarksX, y, remarksWidth, rowHeight, rowIndex % 2 ? [0.98, 0.98, 0.99] : undefined);
      content += text(fit(item.remarks, remarksWidth, 5), remarksX + 3, y + rowHeight / 2 - 2, 5);
    });
    pages.push(content);
  }
  const encoder = new TextEncoder();
  const logoBytes = Uint8Array.from(atob(programmeLogoJpegBase64), character => character.charCodeAt(0));
  const logoStream = ascii85Encode(logoBytes);
  const pageObjectIds = pages.map((_, index) => 6 + index * 2);
  const objects: string[] = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    `<< /Type /Pages /Kids [${pageObjectIds.map(id => `${id} 0 R`).join(" ")}] /Count ${pages.length} >>`,
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold >>",
    `<< /Type /XObject /Subtype /Image /Width 180 /Height 59 /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter [/ASCII85Decode /DCTDecode] /Length ${encoder.encode(logoStream).length} >>\nstream\n${logoStream}\nendstream`,
  ];
  pages.forEach((content, index) => {
    const contentId = 7 + index * 2;
    objects.push(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${pageWidth} ${pageHeight}] /Resources << /Font << /F1 3 0 R /F2 4 0 R >> /XObject << /Logo 5 0 R >> >> /Contents ${contentId} 0 R >>`);
    objects.push(`<< /Length ${encoder.encode(content).length} >>\nstream\n${content}endstream`);
  });
  let pdf = "%PDF-1.4\n%\xE2\xE3\xCF\xD3\n";
  const offsets = [0];
  objects.forEach((object, index) => {
    offsets.push(encoder.encode(pdf).length);
    pdf += `${index + 1} 0 obj\n${object}\nendobj\n`;
  });
  const xrefOffset = encoder.encode(pdf).length;
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  offsets.slice(1).forEach(offset => { pdf += `${String(offset).padStart(10, "0")} 00000 n \n`; });
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF`;
  const url = URL.createObjectURL(new Blob([encoder.encode(pdf)], { type: "application/pdf" }));
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = fileName;
  anchor.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 0);
};
const workflowTone = (value: string) =>
  value === "Approved" || value === "Closed" || value === "Accepted" || value === "Shared"
    ? "default" : value === "Rejected" || value === "Sent Back" ? "destructive" : "secondary";

function PageHeader({ title, description, action }: { title: string; description: string; action?: React.ReactNode }) {
  return <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
    <div><h1 className="text-2xl font-semibold tracking-tight">{title}</h1><p className="mt-1 text-sm text-muted-foreground">{description}</p></div>{action}
  </div>;
}

function State({ loading, error, empty, label = "No records found." }: { loading: boolean; error: unknown; empty: boolean; label?: string }) {
  if (loading) return <Card><CardContent className="py-14 text-center text-muted-foreground">Loading…</CardContent></Card>;
  if (error) return <Card className="border-destructive"><CardContent className="py-10 text-center text-destructive">{errorText(error)}</CardContent></Card>;
  if (empty) return <Card><CardContent className="py-14 text-center"><FolderOpen className="mx-auto mb-3 size-8 text-muted-foreground"/><p>{label}</p></CardContent></Card>;
  return null;
}

function Pager({ page, total, onPage }: { page: number; total: number; onPage: (page: number) => void }) {
  return <div className="flex items-center justify-between pt-4 text-sm text-muted-foreground">
    <span>{total} total</span><div className="flex gap-2"><Button variant="outline" size="sm" disabled={page === 1} onClick={() => onPage(page - 1)}>Previous</Button><Button variant="outline" size="sm" disabled={page * PAGE_SIZE >= total} onClick={() => onPage(page + 1)}>Next</Button></div>
  </div>;
}

function AuditNav() {
  const links = [["Dashboard", "/audit"], ["Schedules", "/audit/schedules"], ["Plans", "/audit/plans"], ["Audits", "/audit/audits"], ["CAR register", "/audit/cars"], ["Reports", "/audit/reports"]];
  return <nav className="flex gap-1 overflow-x-auto border-b pb-3">{links.map(([label, href]) => <Button key={href} variant="ghost" size="sm" asChild><Link href={href}>{label}</Link></Button>)}</nav>;
}

function Layout({ children }: { children: React.ReactNode }) {
  return <main className="mx-auto max-w-7xl space-y-6 p-4 md:p-8"><div className="rounded-xl bg-primary p-6 text-primary-foreground"><div className="flex items-center gap-3"><ShieldCheck className="size-8"/><div><p className="font-semibold">QMS Audit Management</p><p className="text-sm opacity-80">ISO 9001 audit lifecycle workspace</p></div></div></div><AuditNav/>{children}</main>;
}

function Dashboard() {
  const query = useGetAuditDashboard();
  const metrics = (query.data?.metrics ?? {}) as Record<string, unknown>;
  const number = (keys: string[]) => Number(keys.map(k => metrics[k]).find(v => v !== undefined) ?? 0);
  const open = number(["openAudits", "open"]);
  const closed = number(["closedAudits", "closed"]);
  const findings = ["Conformity", "Observation", "Minor NC", "Major NC"].map(k => ({ name: k, value: Number((metrics.findingsByClassification as Record<string, number> | undefined)?.[k] ?? metrics[k] ?? 0) }));
  const cars = ["Open", "Submitted", "Accepted", "Rejected", "Closed"].map(k => ({ name: k, value: Number((metrics.carsByStatus as Record<string, number> | undefined)?.[k] ?? 0) }));
  const overdue = (metrics.overdueCars as Array<Record<string, unknown>> | undefined) ?? [];
  const escalations = useGetAuditEscalations({ page: 1, limit: 20 });
  const openEscalations = (escalations.data?.items ?? []).filter((e) => e.status === "open");
  if (query.isLoading || query.error) return <State loading={query.isLoading} error={query.error} empty={false}/>;
  return <div className="space-y-6">
    <PageHeader title="Audit dashboard" description={`Live operational view · refreshed ${date(query.data?.generatedAt)}`}/>
    <div className="grid gap-4 md:grid-cols-4">
      <Metric label="Open audits" value={open} icon={<ClipboardCheck/>}/><Metric label="Closed audits" value={closed} icon={<CheckCircle2/>}/>
      <Metric label="Open CARs" value={cars.find(c => c.name === "Open")?.value ?? 0} icon={<AlertTriangle/>}/><Metric label="Overdue CARs" value={overdue.length || number(["overdueCarsCount"])} icon={<CalendarDays/>}/>
    </div>
    <div className="grid gap-6 lg:grid-cols-2">
      <Card><CardHeader><CardTitle>Findings by classification</CardTitle><CardDescription>Current classification mix</CardDescription></CardHeader><CardContent className="space-y-4">{findings.map((item, index) => <div key={item.name}><div className="mb-1 flex justify-between text-sm"><span>{item.name}</span><b>{item.value}</b></div><Progress value={findings.reduce((a,b)=>a+b.value,0) ? item.value / findings.reduce((a,b)=>a+b.value,0) * 100 : 0} className={index === 3 ? "[&>div]:bg-destructive" : ""}/></div>)}</CardContent></Card>
      <Card><CardHeader><CardTitle>CAR status pipeline</CardTitle><CardDescription>Progress from open to verified closure</CardDescription></CardHeader><CardContent className="space-y-4">{cars.map(item => <div key={item.name}><div className="mb-1 flex justify-between text-sm"><span>{item.name}</span><b>{item.value}</b></div><Progress value={Math.min(100, item.value * 10)}/></div>)}</CardContent></Card>
    </div>
    <Card className={overdue.length ? "border-destructive" : ""}><CardHeader><CardTitle className="flex items-center gap-2"><AlertTriangle className="size-5"/>Overdue CAR alerts</CardTitle></CardHeader><CardContent>{overdue.length ? <div className="space-y-2">{overdue.map((item, i) => <div key={String(item.id ?? i)} className="flex justify-between rounded-md bg-muted p-3 text-sm"><span>{String(item.responsibleDepartment ?? item.title ?? `CAR ${i + 1}`)}</span><Badge variant="destructive">{date(item.dueDate as string)}</Badge></div>)}</div> : <p className="text-sm text-muted-foreground">No overdue CARs.</p>}</CardContent></Card>
    <Card><CardHeader><CardTitle>Open escalations</CardTitle><CardDescription>Records that breached an escalation rule</CardDescription></CardHeader><CardContent>{openEscalations.length ? <div className="space-y-2">{openEscalations.map((e) => <div key={e.id} className="flex justify-between rounded-md bg-muted p-3 text-sm"><span className="capitalize">{e.recordType.replaceAll("_", " ")}</span><Badge variant="destructive">{e.level} · due {date(e.dueAt)}</Badge></div>)}</div> : <p className="text-sm text-muted-foreground">No open escalations.</p>}</CardContent></Card>
  </div>;
}

function Metric({ label, value, icon }: { label: string; value: number; icon: React.ReactNode }) {
  return <Card><CardContent className="flex items-center justify-between p-5"><div><p className="text-sm text-muted-foreground">{label}</p><p className="mt-1 text-3xl font-semibold">{value}</p></div><div className="rounded-lg bg-accent p-3 text-accent-foreground">{icon}</div></CardContent></Card>;
}

function ScheduleForm({ initial, onClose, parentId, parentRange }: { initial?: AuditSchedule; onClose: () => void; parentId?: string; parentRange?: ProgrammeRange }) {
  const qc = useQueryClient(); const { toast } = useToast();
  const fc = useFieldControls("audit", "schedule"); const ro = (key: string) => fc.fieldProps(key).disabled; const req = (key: string) => fc.fieldProps(key).required;
  const [createdScheduleId, setCreatedScheduleId] = useState<string | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [form, setForm] = useState<AuditSchedule>(initial ?? {
    id: crypto.randomUUID(), parentId: parentId ?? null, year: new Date().getFullYear(), title: "", projectIds: [], auditTypes: [],
    auditCategory: "", departmentProject: "", location: "", processProductOwner: "",
    plannedStartDate: "", plannedEndDate: "", qaqcReference: `QAM-IA/${new Date().getFullYear().toString().slice(-2)}-`,
    auditNumber: `AUD-${new Date().getFullYear()}-`, qaqcScope: "System and Process audits against ISO 9001:2015",
    qaqcClauses: "ISO 9001 — All clauses", remarks: "", l1Name: "", l1ReviewStatus: "Pending",
    l1ReviewComments: "", l1Attachments: [], l2Name: "", l2ReviewStatus: "Pending", l2ReviewComments: "",
    l2Attachments: [], memoDescription: "", memoCirculation: "", ownerId: "", workflowState: "Draft",
    currentApprovalRole: null, approvalRoles: [], canReview: false,
  });
  const create = useCreateAuditSchedule(); const update = useUpdateAuditSchedule();
  const auditTypes = useLov("audit_types");
  const auditCategories = useLov("audit_categories");
  const processOwners = useLov("process_product_owners");
  const departments = useLov("departments");
  const projects = useListPlatformProjects({ page: 1, limit: 200 });
  const projectRows = projects.data?.items ?? [];
  const projectOptions = projectRows.map(project => ({
    value: project.id,
    label: project.code ? `${project.code} — ${project.name}` : project.name,
  }));
  const selectedAuditType = form.auditTypes?.[0] ?? "";
  const selectedAuditTypeLabel = auditTypes.options.find(option => option.value === selectedAuditType)?.label;
  const isProcessAudit = selectedAuditType === PROCESS_AUDIT_TYPE || selectedAuditTypeLabel === PROCESS_AUDIT_TYPE;
  const selectedProjectId = form.projectIds?.[0]
    ?? projectRows.find(project => project.name === form.departmentProject)?.id
    ?? "";
  useEffect(() => {
    if (isProcessAudit || !projectRows.length) return;
    const selected = form.projectIds?.[0]
      ? projectRows.find(project => project.id === form.projectIds![0])
      : projectRows.find(project => project.name === form.departmentProject);
    if (!selected || (form.projectIds?.[0] === selected.id && form.departmentProject === selected.name)) return;
    setForm(current => ({ ...current, projectIds: [selected.id], departmentProject: selected.name }));
  }, [isProcessAudit, projectRows, form.projectIds, form.departmentProject]);
  const selectProject = (projectId: string) => {
    const project = projectRows.find(item => item.id === projectId);
    setForm(current => ({
      ...current,
      projectIds: [projectId],
      departmentProject: project?.name ?? "",
    }));
    setErrors(current => {
      if (!current.departmentProject && !current.projectIds) return current;
      const next = { ...current };
      delete next.departmentProject;
      delete next.projectIds;
      return next;
    });
  };
  const selectAuditType = (value: string) => {
    setForm(current => ({ ...current, auditTypes: [value], projectIds: [], departmentProject: "" }));
    setErrors(current => {
      const next = { ...current };
      delete next.auditTypes;
      delete next.departmentProject;
      delete next.projectIds;
      return next;
    });
  };
  const selectedDepartmentValue = departments.options.find(option =>
    option.value === form.departmentProject || option.label === form.departmentProject)?.value ?? form.departmentProject ?? "";
  const selectDepartment = (value: string) => {
    const department = departments.options.find(option => option.value === value);
    setForm(current => ({ ...current, projectIds: [], departmentProject: department?.label ?? value }));
    setErrors(current => {
      const next = { ...current };
      delete next.departmentProject;
      delete next.projectIds;
      return next;
    });
  };
  const save = async () => {
    const missing: Record<string, string> = {};
    if (!form.auditTypes?.length) missing.auditTypes = "Audit Type is required.";
    if (!form.auditCategory) missing.auditCategory = "Audit Category is required.";
    if (!form.departmentProject?.trim() || (!isProcessAudit && !form.projectIds?.length)) missing.departmentProject = `${isProcessAudit ? "Department" : "Project"} is required.`;
    if (!form.title.trim()) missing.title = "Audit Title is required.";
    if (!form.processProductOwner?.trim()) missing.processProductOwner = "Process / Product Owner is required.";
    if (!form.plannedStartDate) missing.plannedStartDate = "From Date is required.";
    if (!form.plannedEndDate) missing.plannedEndDate = "To Date is required.";
    if (!missing.plannedStartDate && !missing.plannedEndDate && form.plannedEndDate.slice(0, 10) < form.plannedStartDate.slice(0, 10)) missing.plannedEndDate = "To Date must be on or after From Date.";
    if (parentRange && form.plannedStartDate && form.plannedStartDate.slice(0, 10) < parentRange.fromDate) missing.plannedStartDate = `From Date must be on or after ${parentRange.fromDate}.`;
    if (parentRange && form.plannedEndDate && form.plannedEndDate.slice(0, 10) > parentRange.toDate) missing.plannedEndDate = `To Date must be on or before ${parentRange.toDate}.`;
    const alwaysOptional = new Set(["location", "l1Name", "l1ReviewStatus", "l1ReviewComments", "l1Attachments", "l2Name", "l2ReviewStatus", "l2ReviewComments", "l2Attachments", "memoDescription", "memoCirculation"]);
    for (const key of fc.mandatoryFieldKeys()) {
      if (alwaysOptional.has(key)) continue;
      if (missing[key]) continue;
      const value = (form as unknown as Record<string, unknown>)[key];
      const empty = Array.isArray(value) ? value.length === 0 : value == null || (typeof value === "string" && !value.trim());
      if (empty) missing[key] = "This field is required by your administrator.";
    }
    if (Object.keys(missing).length) {
      setErrors(missing);
      const first = Object.keys(missing)[0];
      requestAnimationFrame(() => document.getElementById(`schedule-${first}`)?.scrollIntoView({ behavior: "smooth", block: "center" }));
      toast({ title: "Complete required fields", description: "Update the fields highlighted in red.", variant: "destructive" });
      return;
    }
    setErrors({});
    let savedScheduleId: string | null = null;
    try {
      if (initial) {
        await update.mutateAsync({ id: initial.id, data: form });
        savedScheduleId = initial.id;
      } else if (createdScheduleId) {
        await update.mutateAsync({ id: createdScheduleId, data: { ...form, id: createdScheduleId } });
        savedScheduleId = createdScheduleId;
      }
      else {
        await create.mutateAsync({ data: form });
        savedScheduleId = form.id;
        setCreatedScheduleId(savedScheduleId);
      }
      qc.invalidateQueries({ queryKey: ["/api/audit/schedules"] });
      qc.invalidateQueries({ queryKey: ["/api/audit/programmes"] });
      toast({ title: initial ? "Schedule updated" : "Schedule created" });
      onClose();
    } catch (e) {
      toast({
        title: "Unable to save",
        description: errorText(e),
        variant: "destructive",
      });
    }
  };
  const field = (key: keyof AuditSchedule, value: unknown) => {
    setForm(v => ({ ...v, [key]: value }));
    setErrors(current => {
      const related = key === "l1ReviewStatus" ? "l1ReviewComments" : key === "l2ReviewStatus" ? "l2ReviewComments" : undefined;
      if (!current[key] && (!related || !current[related])) return current;
      const next = { ...current }; delete next[key]; if (related) delete next[related];
      if (key === "plannedStartDate" || key === "plannedEndDate") { delete next.plannedStartDate; delete next.plannedEndDate; }
      return next;
    });
  };
  const error = (key: keyof AuditSchedule) => errors[key] ? <p className="mt-1 text-sm font-medium text-destructive" role="alert">{errors[key]}</p> : null;
  const invalid = (key: keyof AuditSchedule) => errors[key] ? "border-destructive focus-visible:ring-destructive" : "";
  return <div className="grid gap-4 py-2">
    <div id="schedule-auditTypes"><Label>1. Audit Type *</Label><Select value={form.auditTypes?.[0] ?? ""} disabled={auditTypes.isLoading || ro("auditTypes")} onValueChange={selectAuditType}><SelectTrigger aria-invalid={!!errors.auditTypes} className={invalid("auditTypes")}><SelectValue placeholder="Select audit type"/></SelectTrigger><SelectContent>{withLegacyOption(auditTypes.options, form.auditTypes?.[0]).map(x=><SelectItem key={x.value} value={x.value}>{x.label}</SelectItem>)}</SelectContent></Select>{error("auditTypes")}</div>
    <div id="schedule-auditCategory"><Label>2. Audit Category *</Label><Select value={form.auditCategory ?? ""} disabled={auditCategories.isLoading || ro("auditCategory")} onValueChange={v => field("auditCategory", v)}><SelectTrigger aria-invalid={!!errors.auditCategory} className={invalid("auditCategory")}><SelectValue placeholder="Select category"/></SelectTrigger><SelectContent>{withLegacyOption(auditCategories.options, form.auditCategory).map(x => <SelectItem key={x.value} value={x.value}>{x.label}</SelectItem>)}</SelectContent></Select>{error("auditCategory")}</div>
    <div id="schedule-departmentProject">
      <Label>3. {isProcessAudit ? "Department" : "Project"} *</Label>
      <Select value={isProcessAudit ? selectedDepartmentValue : selectedProjectId}
        disabled={isProcessAudit ? departments.isLoading || ro("departmentProject") : projects.isLoading || projects.isError || projectOptions.length === 0 || ro("departmentProject")}
        onValueChange={isProcessAudit ? selectDepartment : selectProject}>
        <SelectTrigger aria-invalid={!!errors.departmentProject} className={invalid("departmentProject")}>
          <SelectValue placeholder={isProcessAudit ? (departments.isLoading ? "Loading departments…" : "Select department") : (projects.isLoading ? "Loading projects…" : "Select project")} />
        </SelectTrigger>
        <SelectContent>
          {(isProcessAudit ? withLegacyOption(departments.options, form.departmentProject) : projectOptions).map(x => <SelectItem key={x.value} value={x.value}>{x.label}</SelectItem>)}
        </SelectContent>
      </Select>
      {isProcessAudit && departments.error
        ? <p className="mt-1 text-sm text-destructive" role="alert">Departments could not be loaded. Ask an administrator to configure the departments master-data list.</p>
        : isProcessAudit && !departments.isLoading && departments.options.length === 0
          ? <p className="mt-1 text-sm text-muted-foreground">No active departments are available in master data.</p>
          : !isProcessAudit && projects.isError
        ? <p className="mt-1 text-sm text-destructive" role="alert">Projects could not be loaded. Please try again or contact an administrator.</p>
        : !projects.isLoading && projectOptions.length === 0
          ? <p className="mt-1 text-sm text-muted-foreground">No active projects are available. Ask an administrator to add a project in organization settings.</p>
          : null}
      {error("departmentProject")}
    </div>
    <div id="schedule-location"><Label>4. Location</Label><Input value={form.location ?? ""} disabled={ro("location")} onChange={e => field("location", e.target.value)} placeholder="Optional"/></div>
    <div id="schedule-title"><Label>5. Audit Title *</Label><Input aria-invalid={!!errors.title} className={invalid("title")} value={form.title} disabled={ro("title")} onChange={e => field("title", e.target.value)}/>{error("title")}</div>
    <div id="schedule-processProductOwner"><Label>6. Process / Product Owner *</Label><Select value={form.processProductOwner ?? ""} disabled={processOwners.isLoading || ro("processProductOwner")} onValueChange={v => field("processProductOwner", v)}><SelectTrigger aria-invalid={!!errors.processProductOwner} className={invalid("processProductOwner")}><SelectValue placeholder="Select owner"/></SelectTrigger><SelectContent>{withLegacyOption(processOwners.options, form.processProductOwner).map(x => <SelectItem key={x.value} value={x.value}>{x.label}</SelectItem>)}</SelectContent></Select>{error("processProductOwner")}</div>
     <div className="grid grid-cols-2 gap-3"><div id="schedule-plannedStartDate"><Label>7. From Date *</Label><Input aria-invalid={!!errors.plannedStartDate} className={invalid("plannedStartDate")} type="date" min={parentRange?.fromDate} max={parentRange?.toDate} value={form.plannedStartDate.slice(0,10)} disabled={ro("plannedStartDate")} onChange={e => field("plannedStartDate", e.target.value)}/>{error("plannedStartDate")}</div><div id="schedule-plannedEndDate"><Label>To Date *</Label><Input aria-invalid={!!errors.plannedEndDate} className={invalid("plannedEndDate")} type="date" min={parentRange?.fromDate} max={parentRange?.toDate} value={form.plannedEndDate.slice(0,10)} disabled={ro("plannedEndDate")} onChange={e => field("plannedEndDate", e.target.value)}/>{error("plannedEndDate")}</div></div>
    <div><Label>8. QA/QC Reference *</Label><Input readOnly value={form.qaqcReference ?? ""}/></div>
    <div><Label>9. Audit Number / Site Visit No. *</Label><Input readOnly value={form.auditNumber ?? ""}/></div>
    <div><Label>10. QA/QC Scope *</Label><Input readOnly value={form.qaqcScope ?? ""}/></div>
    <div><Label>11. QA/QC Clauses *</Label><Input readOnly value={form.qaqcClauses ?? ""}/></div>
    <div><Label>12. Remarks{req("remarks") ? " *" : ""}</Label><Textarea value={form.remarks ?? ""} disabled={ro("remarks")} onChange={e => field("remarks", e.target.value)}/></div>
    <DialogFooter><Button variant="outline" onClick={onClose}>Cancel</Button><Button onClick={() => void save()} disabled={create.isPending || update.isPending}>Save schedule</Button></DialogFooter>
  </div>;
}

function ScheduleGantt({ items, onDisplay, onEdit, onNewPlan }: {
  items: AuditSchedule[];
  onDisplay: (item: AuditSchedule) => void;
  onEdit: (item: AuditSchedule) => void;
  onNewPlan: (item: AuditSchedule) => void;
}) {
  if (items.length === 0) return null;

  const year = items[0]?.year ?? new Date().getFullYear();
  const timeline = programmeTimeline(year);
  const { months, monthStartSlots, totalSlots } = timeline;
  const weekWidth = 36;
  const timelineWidth = totalSlots * weekWidth;
  const fixedColumns = [
    { label: "Business Category", width: 190 },
    { label: "Department / Project", width: 190 },
    { label: "Process Owner", width: 170 },
    { label: "Audit Number / Site Visit No", width: 180 },
    { label: "QA/QC Reference", width: 160 },
    { label: "QA/QC Scope", width: 220 },
    { label: "QA/QC Clauses", width: 190 },
  ];
  const remarksWidth = 220;
  const totalWidth = fixedColumns.reduce((sum, column) => sum + column.width, 0) + timelineWidth + remarksWidth;
  return (
    <div className="overflow-x-auto rounded-xl border bg-card shadow-sm">
      <div style={{ minWidth: totalWidth }}>
        <div className="flex border-b bg-muted/40 text-[10px] font-bold uppercase tracking-wide text-muted-foreground">
          {fixedColumns.map(column => (
            <div key={column.label} className="flex h-16 shrink-0 items-center border-r px-3" style={{ width: column.width }}>{column.label}</div>
          ))}
          <div className="shrink-0" style={{ width: timelineWidth }}>
            <div className="flex h-8 border-b">
              {months.map(month => (
                <div key={month.label} className="flex shrink-0 items-center justify-center border-r px-1 text-center" style={{ width: month.weeks * weekWidth }}>{month.label}</div>
              ))}
            </div>
            <div className="flex h-8">
              {months.flatMap((month, monthIndex) => Array.from({ length: month.weeks }, (_, week) => (
                <div key={`${month.label}-${week}`} className="flex shrink-0 items-center justify-center border-r" style={{ width: weekWidth }}>W{monthStartSlots[monthIndex] + week + 1}</div>
              )))}
            </div>
          </div>
          <div className="flex h-16 shrink-0 items-center border-l px-3" style={{ width: remarksWidth }}>Remarks</div>
        </div>
        <div className="divide-y text-sm">
          {items.map(item => {
            const startPosition = programmeTimelinePosition(item.plannedStartDate, year, false, timeline);
            const endPosition = programmeTimelinePosition(item.plannedEndDate, year, true, timeline);
            const barLeft = Math.max(0, Math.min(totalSlots, startPosition)) * weekWidth;
            const barWidth = Math.max(0, Math.min(totalSlots, endPosition) * weekWidth - barLeft);

            return (
              <div key={item.id} className="group flex min-h-24 transition-colors hover:bg-muted/30">
                <div className="flex shrink-0 flex-col justify-center border-r p-3" style={{ width: fixedColumns[0].width }}>
                  <span className="font-medium">{item.auditCategory || "—"}</span>
                  <div className="mt-2 flex flex-wrap gap-1">
                    <Button size="sm" variant="outline" className="h-7 px-2 text-xs" onClick={() => onDisplay(item)}>Display</Button>
                    {item.workflowState === "Draft" && <Button size="sm" variant="outline" className="h-7 px-2 text-xs" onClick={() => onEdit(item)}>Edit</Button>}
                    <Button size="sm" className="h-7 px-2 text-xs" onClick={() => onNewPlan(item)}>New Plan</Button>
                  </div>
                </div>
                <div className="flex shrink-0 items-center border-r p-3 text-xs" style={{ width: fixedColumns[1].width }}>{item.departmentProject || "—"}</div>
                <div className="flex shrink-0 items-center border-r p-3 text-xs" style={{ width: fixedColumns[2].width }}>{item.processProductOwner || "—"}</div>
                <div className="flex shrink-0 items-center border-r p-3 text-xs" style={{ width: fixedColumns[3].width }}>{item.auditNumber || "—"}</div>
                <div className="flex shrink-0 items-center border-r p-3 text-xs" style={{ width: fixedColumns[4].width }}>{item.qaqcReference || "—"}</div>
                <div className="flex shrink-0 items-center border-r p-3 text-xs leading-relaxed" style={{ width: fixedColumns[5].width }}>{item.qaqcScope || "—"}</div>
                <div className="flex shrink-0 items-center border-r p-3 text-xs leading-relaxed" style={{ width: fixedColumns[6].width }}>{item.qaqcClauses || "—"}</div>
                <div className="relative shrink-0" style={{ width: timelineWidth }}>
                  <div className="absolute inset-0 flex pointer-events-none">
                    {Array.from({ length: totalSlots }, (_, week) => <div key={week} className="h-full shrink-0 border-r border-border/60" style={{ width: weekWidth }} />)}
                  </div>
                  {barWidth > 0 && (
                    <button
                      type="button"
                      className="absolute top-1/2 -translate-y-1/2 h-8 rounded-md bg-primary text-primary-foreground shadow-md flex items-center overflow-hidden text-[10px] px-2 whitespace-nowrap cursor-pointer transition-transform hover:scale-[1.02] border border-primary-foreground/20 hover:brightness-110 group-hover:shadow-lg" 
                      style={{ left: barLeft, width: Math.max(barWidth, 4) }}
                      onClick={() => onDisplay(item)}
                      title={`${date(item.plannedStartDate)} – ${date(item.plannedEndDate)}`}
                    >
                      {barWidth > 80 && <span className="truncate font-medium">{date(item.plannedStartDate)} – {date(item.plannedEndDate)}</span>}
                    </button>
                  )}
                </div>
                <div className="flex shrink-0 items-center border-l p-3 text-xs leading-relaxed" style={{ width: remarksWidth }}>{item.remarks || "—"}</div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

function ProgrammeForm({ onClose }: { onClose: () => void }) {
  const create = useCreateAuditProgramme();
  const qc = useQueryClient();
  const { toast } = useToast();
  const [title, setTitle] = useState("");
  const [fromDate, setFromDate] = useState("");
  const [toDate, setToDate] = useState("");
  const save = () => {
    if (!title.trim() || !fromDate || !toDate) {
      toast({ title: "Complete the programme details", description: "Audit Title, From Date and To Date are required.", variant: "destructive" });
      return;
    }
    if (toDate < fromDate) {
      toast({ title: "Invalid date range", description: "To Date must be on or after From Date.", variant: "destructive" });
      return;
    }
    create.mutate({ data: { title: title.trim(), fromDate, toDate } }, {
      onSuccess: () => {
        qc.invalidateQueries({ queryKey: ["/api/audit/programmes"] });
        toast({ title: "Audit schedule created" });
        onClose();
      },
      onError: (error) => toast({ title: "Unable to create audit schedule", description: errorText(error), variant: "destructive" }),
    });
  };
  return <div className="grid gap-4 py-2">
    <div><Label htmlFor="programme-title">Audit Title</Label><Input id="programme-title" value={title} onChange={e => setTitle(e.target.value)} /></div>
    <div className="grid gap-4 sm:grid-cols-2">
      <div><Label htmlFor="programme-from">From Date</Label><Input id="programme-from" type="date" value={fromDate} onChange={e => setFromDate(e.target.value)} /></div>
      <div><Label htmlFor="programme-to">To Date</Label><Input id="programme-to" type="date" value={toDate} onChange={e => setToDate(e.target.value)} /></div>
    </div>
    <DialogFooter><Button variant="outline" onClick={onClose}>Cancel</Button><Button onClick={save} disabled={create.isPending}>Save audit schedule</Button></DialogFooter>
  </div>;
}

function Programmes() {
  const [page, setPage] = useState(1);
  const [open, setOpen] = useState(false);
  const query = useListAuditProgrammes({ page, limit: PAGE_SIZE });
  const qc = useQueryClient();
  const { toast } = useToast();
  const submit = useSubmitAuditProgramme();
  const review = useReviewAuditProgramme();
  const done = (message: string) => { qc.invalidateQueries({ queryKey: ["/api/audit/programmes"] }); toast({ title: message }); };
  return <div className="space-y-5">
    <PageHeader title="Audit schedules" description="Create and manage annual audit programmes" action={<Button onClick={() => setOpen(true)}><Plus className="mr-2 size-4"/>New Schedule</Button>} />
    <Dialog open={open} onOpenChange={setOpen}><DialogContent className="max-w-lg"><DialogHeader><DialogTitle>New Schedule</DialogTitle></DialogHeader><ProgrammeForm onClose={() => setOpen(false)} /></DialogContent></Dialog>
    <State loading={query.isLoading} error={query.error} empty={!(query.data?.items?.length)} label="No audit schedules found." />
    {!!query.data?.items?.length && <Card><Table><TableHeader><TableRow><TableHead>Audit schedule</TableHead><TableHead>Dates</TableHead><TableHead>Audits</TableHead><TableHead>Status</TableHead><TableHead className="text-right">Actions</TableHead></TableRow></TableHeader><TableBody>
      {query.data.items.map(item => <TableRow key={item.id}><TableCell><Button variant="link" className="h-auto p-0 text-left font-semibold" asChild><Link href={`/audit/schedules/${item.id}`}>{item.title}</Link></Button><div className="text-xs text-muted-foreground">{item.currentApprovalRole ? `Pending ${item.currentApprovalRole}` : "Annual programme"}</div></TableCell><TableCell>{date(item.fromDate)} – {date(item.toDate)}</TableCell><TableCell>{item.childCount}</TableCell><TableCell><Badge variant={workflowTone(item.workflowState)}>{item.workflowState}</Badge></TableCell><TableCell><div className="flex justify-end gap-1">
        {item.id !== "legacy" && item.workflowState === "Draft" && <Button size="sm" disabled={item.childCount === 0 || submit.isPending} onClick={() => submit.mutate({ id: item.id }, { onSuccess: () => done("Audit schedule submitted"), onError: e => toast({ title: "Unable to submit schedule", description: errorText(e), variant: "destructive" }) })}>Submit</Button>}
        {item.id !== "legacy" && item.workflowState === "Submitted" && item.canReview && <><Button size="sm" onClick={() => review.mutate({ id: item.id, data: { decision: "approve" } }, { onSuccess: () => done("Audit schedule approved"), onError: e => toast({ title: "Unable to approve schedule", description: errorText(e), variant: "destructive" }) })}>Approve</Button><Button size="sm" variant="outline" onClick={() => { const comments = window.prompt("Send-back remarks (required)"); if (comments?.trim()) review.mutate({ id: item.id, data: { decision: "send_back", comments } }, { onSuccess: () => done("Audit schedule sent back") }); }}>Send back</Button></>}
      </div></TableCell></TableRow>)}
    </TableBody></Table><CardContent><Pager page={page} total={query.data?.total ?? 0} onPage={setPage} /></CardContent></Card>}
  </div>;
}

function Schedules() {
  const { parentId = "" } = useParams<{ parentId: string }>();
  const [page, setPage] = useState(1); const [search, setSearch] = useState(""); const [editing, setEditing] = useState<AuditSchedule | undefined>(); const [open, setOpen] = useState(false); const [displaying, setDisplaying] = useState<AuditSchedule | undefined>();
  const [viewMode, setViewMode] = useState<"list" | "gantt">("list");
  const [planning, setPlanning] = useState<AuditSchedule | undefined>();
  const query = useListAuditSchedules({ page, limit: PAGE_SIZE, parentId }); const qc = useQueryClient(); const { toast } = useToast();
  const programme = useGetAuditProgramme(parentId, { query: { enabled: parentId !== "legacy" && !!parentId, queryKey: getGetAuditProgrammeQueryKey(parentId) } });
  const allChildren = useListAuditSchedules({ page: 1, limit: 200, parentId });
  const projects = useListPlatformProjects({ page: 1, limit: 200 });
  const departments = useLov("departments");
  const create = useCreateAuditSchedule();
  const fileInput = useRef<HTMLInputElement>(null);
  const [loadingFile, setLoadingFile] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const remove = useDeleteAuditSchedule(); const review = useReviewAuditSchedule();
  const items = (query.data?.items ?? []).filter(x => x.title.toLowerCase().includes(search.toLowerCase()));
  const done = (message: string) => { qc.invalidateQueries({ queryKey: ["/api/audit/schedules"] }); qc.invalidateQueries({ queryKey: ["/api/audit/programmes"] }); toast({ title: message }); };
  const sendBack = (id: string) => { const comments = window.prompt("Send-back remarks (required)"); if (comments?.trim()) review.mutate({ id, data: { decision: "send_back", comments } }, { onSuccess: () => done("Schedule sent back") }); };
  const range = parentId !== "legacy" && programme.data ? { fromDate: programme.data.fromDate.slice(0, 10), toDate: programme.data.toDate.slice(0, 10) } : undefined;
  const download = async () => {
    setDownloading(true);
    try {
      const first = await listAuditSchedules({ page: 1, limit: 200, parentId });
      const children = [...first.items];
      for (let nextPage = 2; children.length < first.total; nextPage += 1) {
        const next = await listAuditSchedules({ page: nextPage, limit: 200, parentId });
        children.push(...next.items);
        if (!next.items.length) break;
      }
      const rows = children.map(item => ({
      "Audit Type": item.auditTypes?.join(", ") ?? "", "Audit Category": item.auditCategory ?? "",
      "Department / Project": item.departmentProject ?? "", Location: item.location ?? "", "Audit Title": item.title,
      "Process / Product Owner": item.processProductOwner ?? "", "From Date": item.plannedStartDate.slice(0, 10),
      "To Date": item.plannedEndDate.slice(0, 10), Remarks: item.remarks ?? "",
      }));
      if (viewMode === "gantt") programmePdfDownload(children, `audit-programme-${parentId}.pdf`, programme.data?.title ?? "");
      else workbookDownload(rows, `audit-schedule-${parentId}.xlsx`, range);
    } catch (error) {
      toast({ title: "Unable to download audit schedule", description: errorText(error), variant: "destructive" });
    } finally {
      setDownloading(false);
    }
  };
  const loadFile = async (file: File) => {
    setLoadingFile(true);
    const failures: string[] = []; let created = 0;
    try {
      const workbook = XLSX.read(await file.arrayBuffer(), { type: "array", cellDates: true });
      const first = workbook.Sheets[workbook.SheetNames[0]];
      const formulaCell = first && Object.entries(first).find(([address, cell]) =>
        !address.startsWith("!") && Boolean((cell as XLSX.CellObject).f));
      if (formulaCell) {
        toast({ title: "Formula cells are not supported", description: `Replace the formula in cell ${formulaCell[0]} with its displayed value and load the file again.`, variant: "destructive" });
        return;
      }
      const rows = first ? XLSX.utils.sheet_to_json<Record<string, unknown>>(first, { defval: "" }) : [];
      if (!rows.length) { toast({ title: "No data rows found", variant: "destructive" }); return; }
      const firstProjects = await listPlatformProjects({ page: 1, limit: 200 });
      const projectRows = [...firstProjects.items];
      for (let nextPage = 2; projectRows.length < firstProjects.total; nextPage += 1) {
        const next = await listPlatformProjects({ page: nextPage, limit: 200 });
        projectRows.push(...next.items);
        if (!next.items.length) break;
      }
      for (let index = 0; index < rows.length; index += 1) {
        const source = rows[index]; const mapped: Record<string, unknown> = {};
        Object.entries(source).forEach(([key, value]) => { const target = scheduleHeaderAliases[normalizeHeader(key)]; if (target) mapped[target] = value; });
        const departmentProjectText = String(mapped.departmentProject ?? "").trim();
        const importedAuditTypes = String(mapped.auditTypes).split(",").map(value => value.trim()).filter(Boolean);
        const isImportedProcessAudit = importedAuditTypes.includes(PROCESS_AUDIT_TYPE);
        const project = isImportedProcessAudit ? undefined : projectRows.find(item => item.code === departmentProjectText || item.name === departmentProjectText);
        const department = isImportedProcessAudit
          ? departments.options.find(item => item.value === departmentProjectText || item.label === departmentProjectText)
          : undefined;
        const start = scheduleDate(mapped.plannedStartDate); const end = scheduleDate(mapped.plannedEndDate);
        const required = ["auditTypes", "auditCategory", "departmentProject", "title", "processProductOwner", "plannedStartDate", "plannedEndDate"];
        const missing = required.filter(key => !String(mapped[key] ?? "").trim());
        if (missing.length) { failures.push(`row ${index + 2}: missing ${missing.join(", ")}`); continue; }
        if (!start || !end) { failures.push(`row ${index + 2}: From Date and To Date must be valid calendar dates in YYYY-MM-DD format`); continue; }
        if (isImportedProcessAudit && !department) { failures.push(`row ${index + 2}: Department / Project must be an active department value or exact name`); continue; }
        if (!isImportedProcessAudit && !project) { failures.push(`row ${index + 2}: Department / Project must be an active project code or exact name`); continue; }
        if (end < start) { failures.push(`row ${index + 2}: To Date must be on or after From Date`); continue; }
        if (range && (start < range.fromDate || end > range.toDate)) { failures.push(`row ${index + 2}: dates must be within ${range.fromDate} and ${range.toDate}`); continue; }
        const rowParentId = parentId === "legacy" ? null : parentId;
        const dataWithoutId = {
          parentId: rowParentId, year: Number(start.slice(0, 4)),
          title: String(mapped.title), projectIds: project ? [project.id] : [], auditTypes: importedAuditTypes,
          auditCategory: String(mapped.auditCategory), departmentProject: department?.label ?? project?.name ?? "", location: String(mapped.location ?? ""),
          processProductOwner: String(mapped.processProductOwner), plannedStartDate: start, plannedEndDate: end,
          qaqcReference: `QAM-IA/${start.slice(2, 4)}-`, auditNumber: `AUD-${start.slice(0, 4)}-`,
          qaqcScope: "System and Process audits against ISO 9001:2015", qaqcClauses: "ISO 9001 — All clauses",
          remarks: String(mapped.remarks ?? ""), l1Name: "", l1ReviewStatus: "Pending" as const,
          l1ReviewComments: "", l1Attachments: [], l2Name: "", l2ReviewStatus: "Pending" as const, l2ReviewComments: "",
          l2Attachments: [], memoDescription: "", memoCirculation: "", ownerId: "", workflowState: "Draft",
        };
        const data: AuditSchedule = {
          ...dataWithoutId,
          id: await stableScheduleId(parentId, dataWithoutId),
          currentApprovalRole: null,
          approvalRoles: [],
          canReview: false,
        } as AuditSchedule;
        try { await create.mutateAsync({ data }); created += 1; } catch (error) { failures.push(`row ${index + 2}: ${errorText(error)}`); }
      }
      qc.invalidateQueries({ queryKey: ["/api/audit/schedules"] });
      qc.invalidateQueries({ queryKey: ["/api/audit/programmes"] });
      toast({
        title: `Loaded ${created} audit${created === 1 ? "" : "s"}${failures.length ? `; ${failures.length} failed` : ""}`,
        description: failures.length ? failures.join("; ") : "Every data row was created successfully.",
        variant: failures.length ? "destructive" : "default",
      });
    } catch (error) { toast({ title: "Unable to read audit file", description: errorText(error), variant: "destructive" }); }
    finally { setLoadingFile(false); if (fileInput.current) fileInput.current.value = ""; }
  };
  const programmePending = parentId !== "legacy" && (programme.isLoading || !programme.data);
  return <div className="space-y-5"><PageHeader title="Audits in schedule" description="Build, submit and approve audits in this programme" action={<div className="flex flex-wrap gap-2"><Button variant="outline" onClick={() => void download()} disabled={allChildren.isLoading || downloading || programmePending}><Download className="mr-2 size-4"/>{downloading ? "Downloading…" : "Download"}</Button><Button variant="outline" onClick={() => fileInput.current?.click()} disabled={loadingFile || projects.isLoading || programmePending}><Upload className="mr-2 size-4"/>{loadingFile ? "Loading…" : "Load"}</Button><input ref={fileInput} type="file" accept=".xlsx,.xls,.csv" className="hidden" onChange={event => { const file = event.target.files?.[0]; if (file) void loadFile(file); }}/><Button disabled={programmePending} onClick={() => { setEditing(undefined); setOpen(true); }}><Plus className="mr-2 size-4"/>New Audit</Button></div>}/>
    <div className="flex flex-col sm:flex-row gap-4 items-start sm:items-center justify-between">
      <Input placeholder="Search schedules…" value={search} onChange={e => setSearch(e.target.value)} className="max-w-sm"/>
      <div className="flex items-center gap-1 rounded-lg border p-1 bg-muted/40 shrink-0">
        <Button variant={viewMode === "list" ? "secondary" : "ghost"} size="sm" className="h-8 px-4 font-medium" onClick={() => setViewMode("list")}><FileText className="mr-2 size-4"/>List</Button>
        <Button variant={viewMode === "gantt" ? "secondary" : "ghost"} size="sm" className="h-8 px-4 font-medium" onClick={() => setViewMode("gantt")}><CalendarDays className="mr-2 size-4"/>Programme</Button>
      </div>
    </div>
     <Dialog open={open} onOpenChange={setOpen}><DialogContent className="max-h-[90vh] max-w-2xl overflow-y-auto"><DialogHeader><DialogTitle>{editing ? "Edit audit" : "Create audit"}</DialogTitle></DialogHeader><ScheduleForm initial={editing} parentId={parentId === "legacy" ? undefined : parentId} parentRange={range} onClose={() => setOpen(false)}/></DialogContent></Dialog>
    <Dialog open={!!planning} onOpenChange={isOpen => !isOpen && setPlanning(undefined)}><DialogContent className="max-h-[90vh] max-w-3xl overflow-y-auto"><DialogHeader><DialogTitle>Create Audit Plan</DialogTitle></DialogHeader>{planning && <PlanForm schedules={[planning]} presetSchedule={planning} onClose={() => setPlanning(undefined)}/>}</DialogContent></Dialog>
    <Dialog open={!!displaying} onOpenChange={isOpen => !isOpen && setDisplaying(undefined)}><DialogContent className="max-h-[90vh] max-w-4xl overflow-y-auto">{displaying && <ScheduleDisplay schedule={displaying} onClose={() => setDisplaying(undefined)}/>}</DialogContent></Dialog>
    <State loading={query.isLoading} error={query.error} empty={!items.length}/>
    {items.length > 0 && viewMode === "list" && <Card><Table><TableHeader><TableRow><TableHead>Schedule</TableHead><TableHead>Type</TableHead><TableHead>Dates</TableHead><TableHead>Status</TableHead><TableHead className="text-right">Actions</TableHead></TableRow></TableHeader><TableBody>{items.map(item => <TableRow key={item.id}><TableCell><Button variant="link" className="h-auto p-0 text-left font-semibold" onClick={() => setDisplaying(item)}>{item.title}</Button><div className="text-xs text-muted-foreground">{item.currentApprovalRole ? `Pending ${item.currentApprovalRole}` : item.year}</div></TableCell><TableCell>{item.auditTypes?.join(", ") || "—"}</TableCell><TableCell>{date(item.plannedStartDate)} – {date(item.plannedEndDate)}</TableCell><TableCell><Badge variant={workflowTone(item.workflowState)}>{item.workflowState}</Badge></TableCell><TableCell><div className="flex justify-end gap-1">
      <Button size="sm" variant="outline" onClick={() => setDisplaying(item)}>Display</Button>
      {item.workflowState === "Draft" && <Button size="sm" variant="outline" onClick={() => { setEditing(item); setOpen(true); }}>Edit</Button>}
      <Button size="sm" onClick={() => setPlanning(item)}><Plus className="mr-2 size-4"/>New Plan</Button>
      {item.workflowState === "Submitted" && item.canReview && <><Button size="sm" onClick={() => review.mutate({ id: item.id, data: { decision: "approve" } }, { onSuccess: () => done("Schedule approved") })}>Approve</Button><Button size="sm" variant="outline" onClick={() => sendBack(item.id)}>Send back</Button></>}
      <Button size="icon" variant="ghost" aria-label="Delete" onClick={() => window.confirm("Soft-delete this schedule?") && remove.mutate({ id: item.id }, { onSuccess: () => done("Schedule deleted") })}><Trash2 className="size-4"/></Button>
    </div></TableCell></TableRow>)}</TableBody></Table><CardContent><Pager page={page} total={query.data?.total ?? 0} onPage={setPage}/></CardContent></Card>}
    {items.length > 0 && viewMode === "gantt" && <div className="space-y-4"><ScheduleGantt items={items} onDisplay={setDisplaying} onEdit={item => { setEditing(item); setOpen(true); }} onNewPlan={setPlanning}/><Card className="bg-transparent border-none shadow-none"><CardContent className="p-0"><Pager page={page} total={query.data?.total ?? 0} onPage={setPage}/></CardContent></Card></div>}
  </div>;
}

function ScheduleDisplay({ schedule, onClose }: { schedule: AuditSchedule; onClose: () => void }) {
  const { toast } = useToast();
  const evidence = useListAuditEvidence({ recordType: "audit_schedule", recordId: schedule.id, page: 1, limit: 100 });
  const [fileActionId, setFileActionId] = useState<string | null>(null);
  const openFile = async (file: EvidenceFile) => {
    if (!file.storageUrl) return;
    const preview = window.open("", "_blank");
    if (!preview) {
      toast({ title: "Pop-up blocked", description: "Allow pop-ups for QMS360 to open this attachment.", variant: "destructive" });
      return;
    }
    setFileActionId(file.id);
    try {
      const token = localStorage.getItem("qms360_token");
      const response = await fetch(file.storageUrl, { headers: token ? { Authorization: `Bearer ${token}` } : {} });
      if (!response.ok) throw new Error(`Unable to open ${file.fileName}`);
      const url = URL.createObjectURL(await response.blob());
      preview.location.href = url;
      window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
    } catch (error) {
      preview.close();
      toast({ title: "Unable to open attachment", description: errorText(error), variant: "destructive" });
    } finally {
      setFileActionId(null);
    }
  };
  const downloadFile = async (file: EvidenceFile) => {
    if (!file.storageUrl) return;
    setFileActionId(file.id);
    try {
      const token = localStorage.getItem("qms360_token");
      const response = await fetch(file.storageUrl, { headers: token ? { Authorization: `Bearer ${token}` } : {} });
      if (!response.ok) throw new Error(`Unable to download ${file.fileName}`);
      const url = URL.createObjectURL(await response.blob());
      const anchor = document.createElement("a");
      anchor.href = url; anchor.download = file.fileName; anchor.click();
      window.setTimeout(() => URL.revokeObjectURL(url), 0);
    } catch (error) {
      toast({ title: "Unable to download attachment", description: errorText(error), variant: "destructive" });
    } finally {
      setFileActionId(null);
    }
  };
  const attachments = (category: "l1-review" | "l2-review") => (evidence.data?.items ?? []).filter(file => file.category === category);
  const AttachmentList = ({ category, title }: { category: "l1-review" | "l2-review"; title: string }) => {
    const files = attachments(category);
    return <div className="rounded-lg border p-4"><h3 className="font-medium">{title}</h3>
      {evidence.isLoading ? <p className="mt-2 text-sm text-muted-foreground">Loading attachments…</p>
        : evidence.isError ? <p className="mt-2 text-sm text-destructive">Attachments could not be loaded.</p>
          : files.length === 0 ? <p className="mt-2 text-sm text-muted-foreground">No files attached.</p>
            : <div className="mt-3 space-y-2">{files.map(file => <div key={file.id} className="flex flex-wrap items-center justify-between gap-3 rounded-md bg-muted/50 p-3"><div className="min-w-0"><p className="truncate text-sm font-medium">{file.fileName}</p><p className="text-xs text-muted-foreground">{fileSize(file.sizeBytes)} · {file.status}</p></div><div className="flex gap-2">{file.storageUrl ? <><Button size="sm" variant="outline" disabled={fileActionId === file.id} onClick={() => void openFile(file)}>Open</Button><Button size="sm" disabled={fileActionId === file.id} onClick={() => void downloadFile(file)}><Download className="mr-2 size-4"/>Download</Button></> : <Badge variant="secondary">Not uploaded</Badge>}</div></div>)}</div>}
    </div>;
  };
  const Field = ({ label, value }: { label: string; value?: string | null }) => <div><p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{label}</p><p className="mt-1 whitespace-pre-wrap text-sm">{value?.trim() || "—"}</p></div>;
  return <><DialogHeader><DialogTitle>Audit Schedule</DialogTitle><p className="text-sm text-muted-foreground">Read-only schedule details and review attachments.</p></DialogHeader>
    <div className="space-y-6 py-2"><div className="flex flex-wrap items-start justify-between gap-3"><div><h2 className="text-xl font-semibold">{schedule.title}</h2><p className="mt-1 text-sm text-muted-foreground">Schedule year {schedule.year}</p></div><Badge variant={workflowTone(schedule.workflowState)}>{schedule.workflowState}</Badge></div>
      <div className="grid gap-x-8 gap-y-5 sm:grid-cols-2"><Field label="Audit type" value={schedule.auditTypes?.join(", ")}/><Field label="Audit category" value={schedule.auditCategory}/><Field label="Department / project" value={schedule.departmentProject}/><Field label="Process / product owner" value={schedule.processProductOwner}/><Field label="Planned dates" value={`${date(schedule.plannedStartDate)} – ${date(schedule.plannedEndDate)}`}/><Field label="Location" value={schedule.location}/><Field label="QA/QC reference" value={schedule.qaqcReference}/><Field label="Audit number / site visit no." value={schedule.auditNumber}/><Field label="QA/QC scope" value={schedule.qaqcScope}/><Field label="QA/QC clauses" value={schedule.qaqcClauses}/><Field label="Remarks" value={schedule.remarks}/><Field label="Memo circulation" value={schedule.memoCirculation}/></div>
      <div className="grid gap-4 md:grid-cols-2"><div className="rounded-lg border p-4"><h3 className="font-medium">L1 review</h3><div className="mt-3 grid gap-3"><Field label="Reviewer" value={schedule.l1Name}/><Field label="Status" value={schedule.l1ReviewStatus}/><Field label="Comments" value={schedule.l1ReviewComments}/></div></div><div className="rounded-lg border p-4"><h3 className="font-medium">L2 review</h3><div className="mt-3 grid gap-3"><Field label="Reviewer" value={schedule.l2Name}/><Field label="Status" value={schedule.l2ReviewStatus}/><Field label="Comments" value={schedule.l2ReviewComments}/></div></div></div>
      <div><h3 className="mb-3 font-medium">Attached files</h3><div className="grid gap-4 md:grid-cols-2"><AttachmentList category="l1-review" title="L1 attachments"/><AttachmentList category="l2-review" title="L2 attachments"/></div></div>
      <Field label="Memo description" value={schedule.memoDescription}/>
    </div>
    <DialogFooter><Button onClick={onClose}>Close</Button></DialogFooter></>;
}

function PlanForm({ schedules, onClose, initial, presetSchedule, readOnly = false }: { schedules: AuditSchedule[]; onClose: () => void; initial?: AuditPlan; presetSchedule?: AuditSchedule; readOnly?: boolean }) {
  const [form, setForm] = useState<AuditPlan>(initial ?? {
    id: crypto.randomUUID(), scheduleId: presetSchedule?.id ?? "", auditFeasible: true, auditTitle: presetSchedule?.title ?? "", leadAuditorId: "",
    teamMemberIds: [], auditeeId: "", qaqcScope: "", auditTypes: [],
    auditLanguage: "Verbal: English\nWriting: English", qaqcReference: presetSchedule?.qaqcReference ?? "", description: "",
    startDateTime: "", endDateTime: "", openingMeetingDateTime: "", closingMeetingDateTime: "",
    activitySection: "Opening Meeting", activityRemarks: "", activityAuditeeId: "",
    activityDateTime: "", auditPlanCirculation: "", status: "Draft",
    ...(presetSchedule ? { qaqcScope: presetSchedule.qaqcScope ?? "", auditTypes: presetSchedule.auditTypes ?? [] } : {}),
  });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [offlineContext, setOfflineContext] = useState<AuditPlanOfflineContext | null>(null);
  const fc = useFieldControls("audit", "plan"); const ro = (key: string) => fc.fieldProps(key).disabled;
  const create = useCreateAuditPlan(); const update = useUpdateAuditPlan(); const qc = useQueryClient(); const { toast } = useToast();
  const options = useGetAuditPlanOptions();
  useEffect(() => { void readAuditPlanContext().then(setOfflineContext).catch(() => undefined); }, []);
  useEffect(() => {
    if (options.data?.users && schedules.length) {
      void cacheAuditPlanContext(schedules, options.data.users).then(() => readAuditPlanContext().then(setOfflineContext)).catch(() => undefined);
    }
  }, [options.data, schedules]);
  const users = options.data?.users ?? offlineContext?.users ?? [];
  const effectiveSchedules = schedules.length ? schedules : offlineContext?.schedules ?? [];
  const approvedSchedules = presetSchedule ? [presetSchedule] : effectiveSchedules;
  const clearError = (...keys: string[]) => setErrors(current => {
    const next = { ...current };
    keys.forEach(key => delete next[key]);
    return next;
  });
  const set = (key: keyof AuditPlan, value: unknown) => {
    setForm(v => ({ ...v, [key]: value }));
    clearError(String(key));
  };
  const selectSchedule = (scheduleId: string) => {
    const schedule = approvedSchedules.find(item => item.id === scheduleId);
    if (!schedule) return;
    setForm(current => ({
      ...current, scheduleId, auditTitle: schedule.title, qaqcScope: schedule.qaqcScope ?? "",
      auditTypes: schedule.auditTypes ?? [], qaqcReference: schedule.qaqcReference ?? "",
    }));
    clearError("scheduleId", "auditTitle", "qaqcScope", "auditTypes", "qaqcReference");
  };
  const selectedTeamNames = form.teamMemberIds.map(id => users.find(user => user.id === id)?.fullName).filter(Boolean);
  const circulationIds = [...new Set([form.leadAuditorId, ...form.teamMemberIds, form.auditeeId].filter(Boolean))];
  const circulation = circulationIds.map(id => users.find(user => user.id === id)?.fullName).filter(Boolean).join(", ");
  const toggleTeamMember = (id: string, checked: boolean) => set("teamMemberIds", checked ? [...form.teamMemberIds, id] : form.teamMemberIds.filter(item => item !== id));
  const save = () => {
    const required: Array<[keyof AuditPlan | "circulation", unknown]> = [
      ["scheduleId", form.scheduleId], ["auditTitle", form.auditTitle], ["leadAuditorId", form.leadAuditorId],
      ["teamMemberIds", form.teamMemberIds], ["auditeeId", form.auditeeId], ["qaqcScope", form.qaqcScope],
      ["auditTypes", form.auditTypes], ["auditLanguage", form.auditLanguage], ["qaqcReference", form.qaqcReference],
      ["startDateTime", form.startDateTime], ["endDateTime", form.endDateTime],
      ["openingMeetingDateTime", form.openingMeetingDateTime], ["closingMeetingDateTime", form.closingMeetingDateTime],
      ["activitySection", form.activitySection], ["activityRemarks", form.activityRemarks],
      ["activityAuditeeId", form.activityAuditeeId], ["activityDateTime", form.activityDateTime], ["circulation", circulation],
    ];
    const nextErrors = Object.fromEntries(required.filter(([, value]) => Array.isArray(value) ? !value.length : !String(value ?? "").trim()).map(([key]) => [key, "This field is required."]));
    if (Object.keys(nextErrors).length) {
      setErrors(nextErrors);
      requestAnimationFrame(() => document.querySelector<HTMLElement>("[aria-invalid='true']")?.focus());
      return;
    }
    if (new Date(form.endDateTime) < new Date(form.startDateTime)) {
      setErrors({ endDateTime: "End Date & Time must be on or after Start Date & Time." }); return;
    }
    if (new Date(form.closingMeetingDateTime) < new Date(form.openingMeetingDateTime)) {
      setErrors({ closingMeetingDateTime: "Closing Meeting must be on or after Opening Meeting." }); return;
    }
    setErrors({});
    const payload = { ...form, auditPlanCirculation: circulation };
    const success = (title: string) => { qc.invalidateQueries({ queryKey: ["/api/audit/plans"] }); toast({ title }); onClose(); };
    if (initial) {
      update.mutate({ id: form.id, data: payload }, { onSuccess: () => success("Audit plan updated"), onError: e => toast({ title: "Unable to save", description: errorText(e), variant: "destructive" }) });
      return;
    }
    const saveOffline = async () => {
      try {
        await queueAuditPlan(payload);
        success("Audit plan saved offline. It will sync automatically when the network returns.");
      } catch (error) {
        toast({ title: "Unable to save offline", description: errorText(error), variant: "destructive" });
      }
    };
    if (!navigator.onLine) {
      void saveOffline();
      return;
    }
    create.mutate({ data: payload }, {
      onSuccess: () => success("Audit plan created"),
      onError: e => {
        if (e instanceof TypeError || !navigator.onLine) void saveOffline();
        else toast({ title: "Unable to save", description: errorText(e), variant: "destructive" });
      },
    });
  };
  const ErrorText = ({ name }: { name: string }) => errors[name] ? <p className="mt-1 text-sm text-destructive">{errors[name]}</p> : null;
  const invalid = (name: string) => ({ "aria-invalid": errors[name] ? true as const : undefined });
  const disabled = (key: string) => readOnly || ro(key);
  const activities = ["Opening Meeting", "General Requirement", "Design", "Procurement", "Construction & Installation", "Testing & Commissioning", "Improvements", "Lunch", "Break Time", "Site Visit", "Closing Meeting"] as const;
  return <div className="grid gap-4 py-2">
    {!navigator.onLine && <div className="rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">You are offline. This plan will be saved on this device and synchronized automatically when the network returns.</div>}
    <div className="rounded-lg border bg-muted/30 p-4"><Label>Source Audit Schedule *</Label><Select value={form.scheduleId} disabled={disabled("scheduleId")} onValueChange={selectSchedule}><SelectTrigger className="mt-2" {...invalid("scheduleId")}><SelectValue placeholder="Select an audit schedule"/></SelectTrigger><SelectContent>{approvedSchedules.map(schedule => <SelectItem key={schedule.id} value={schedule.id}>{schedule.title}</SelectItem>)}</SelectContent></Select><ErrorText name="scheduleId"/>{!approvedSchedules.length && <p className="mt-2 text-xs text-muted-foreground">No Audit Schedules are available offline. Connect once to cache current schedule data.</p>}</div>
    <div><Label>1. Audit Feasible *</Label><RadioGroup className="mt-2 flex gap-6" value={form.auditFeasible ? "yes" : "no"} disabled={disabled("auditFeasible")} onValueChange={value => set("auditFeasible", value === "yes")}><div className="flex items-center gap-2"><RadioGroupItem value="yes" id="plan-feasible-yes"/><Label htmlFor="plan-feasible-yes">Yes</Label></div><div className="flex items-center gap-2"><RadioGroupItem value="no" id="plan-feasible-no"/><Label htmlFor="plan-feasible-no">No</Label></div></RadioGroup></div>
    <div><Label>2. Audit Title *</Label><Input className="mt-2" readOnly disabled={readOnly} value={form.auditTitle} {...invalid("auditTitle")} placeholder="Generated from Audit Schedule"/><ErrorText name="auditTitle"/></div>
    <div><Label>3. Lead / Internal Auditor *</Label><Select value={form.leadAuditorId} disabled={disabled("leadAuditorId")} onValueChange={value => set("leadAuditorId", value)}><SelectTrigger className="mt-2" {...invalid("leadAuditorId")}><SelectValue placeholder="Select lead auditor"/></SelectTrigger><SelectContent>{users.map(user => <SelectItem key={user.id} value={user.id}>{user.fullName}{user.designation ? ` — ${user.designation}` : ""}</SelectItem>)}</SelectContent></Select><ErrorText name="leadAuditorId"/></div>
    <div><Label>4. Audit Team *</Label><DropdownMenu><DropdownMenuTrigger asChild><Button type="button" variant="outline" className="mt-2 w-full justify-between font-normal" disabled={disabled("teamMemberIds")} {...invalid("teamMemberIds")}><span className="truncate">{selectedTeamNames.length ? selectedTeamNames.join(", ") : "Select Audit Team"}</span><ChevronDown className="ml-2 size-4 shrink-0"/></Button></DropdownMenuTrigger><DropdownMenuContent className="w-[var(--radix-dropdown-menu-trigger-width)]">{users.map(user => <DropdownMenuCheckboxItem key={user.id} checked={form.teamMemberIds.includes(user.id)} onSelect={event => event.preventDefault()} onCheckedChange={checked => toggleTeamMember(user.id, checked === true)}>{user.fullName}{user.designation ? ` — ${user.designation}` : ""}</DropdownMenuCheckboxItem>)}</DropdownMenuContent></DropdownMenu><ErrorText name="teamMemberIds"/></div>
    <div><Label>5. Auditee *</Label><Select value={form.auditeeId} disabled={disabled("auditeeId")} onValueChange={value => { setForm(current => ({ ...current, auditeeId: value, activityAuditeeId: value })); clearError("auditeeId", "activityAuditeeId", "circulation"); }}><SelectTrigger className="mt-2" {...invalid("auditeeId")}><SelectValue placeholder="Select auditee"/></SelectTrigger><SelectContent>{users.map(user => <SelectItem key={user.id} value={user.id}>{user.fullName}{user.designation ? ` — ${user.designation}` : ""}</SelectItem>)}</SelectContent></Select><ErrorText name="auditeeId"/></div>
    <div><Label>6. QA/QC Scope *</Label><Textarea className="mt-2" readOnly disabled={readOnly} value={form.qaqcScope} {...invalid("qaqcScope")} placeholder="Prefilled from Audit Schedule"/><ErrorText name="qaqcScope"/></div>
    <div><Label>7. Audit Type *</Label><Input className="mt-2" readOnly disabled={readOnly} value={form.auditTypes.join(", ")} {...invalid("auditTypes")} placeholder="Prefilled from Audit Schedule"/><ErrorText name="auditTypes"/></div>
    <div><Label>8. Audit Language *</Label><Textarea className="mt-2" readOnly disabled={readOnly} value={form.auditLanguage} {...invalid("auditLanguage")}/><ErrorText name="auditLanguage"/></div>
    <div><Label>9. QA/QC References *</Label><Select value={form.qaqcReference} disabled={readOnly || !form.scheduleId || ro("qaqcReference")} onValueChange={value => set("qaqcReference", value)}><SelectTrigger className="mt-2" {...invalid("qaqcReference")}><SelectValue placeholder="Select QA/QC reference"/></SelectTrigger><SelectContent>{form.qaqcReference && <SelectItem value={form.qaqcReference}>{form.qaqcReference}</SelectItem>}</SelectContent></Select><ErrorText name="qaqcReference"/></div>
    <div><Label>10. Description of Audit</Label><Textarea className="mt-2" value={form.description ?? ""} disabled={disabled("description")} onChange={event => set("description", event.target.value)} placeholder="Optional"/></div>
    <div><Label>11. Start Date & Time *</Label><Input className="mt-2" type="datetime-local" value={form.startDateTime.slice(0,16)} disabled={disabled("startDateTime")} {...invalid("startDateTime")} onChange={event => set("startDateTime", event.target.value)}/><ErrorText name="startDateTime"/></div>
    <div><Label>12. End Date & Time *</Label><Input className="mt-2" type="datetime-local" value={form.endDateTime.slice(0,16)} disabled={disabled("endDateTime")} {...invalid("endDateTime")} onChange={event => set("endDateTime", event.target.value)}/><ErrorText name="endDateTime"/></div>
    <div><Label>13. Opening Meeting *</Label><Input className="mt-2" type="datetime-local" value={form.openingMeetingDateTime.slice(0,16)} disabled={disabled("openingMeetingDateTime")} {...invalid("openingMeetingDateTime")} onChange={event => set("openingMeetingDateTime", event.target.value)}/><ErrorText name="openingMeetingDateTime"/></div>
    <div><Label>14. Closing Meeting *</Label><Input className="mt-2" type="datetime-local" value={form.closingMeetingDateTime.slice(0,16)} disabled={disabled("closingMeetingDateTime")} {...invalid("closingMeetingDateTime")} onChange={event => set("closingMeetingDateTime", event.target.value)}/><ErrorText name="closingMeetingDateTime"/></div>
    <div><Label>15. Activities / Section *</Label><Select value={form.activitySection} disabled={disabled("activitySection")} onValueChange={value => set("activitySection", value)}><SelectTrigger className="mt-2" {...invalid("activitySection")}><SelectValue/></SelectTrigger><SelectContent>{activities.map(activity => <SelectItem key={activity} value={activity}>{activity}</SelectItem>)}</SelectContent></Select><ErrorText name="activitySection"/></div>
    <div><Label>16. Activities / Section Remarks *</Label><Input className="mt-2" value={form.activityRemarks} disabled={disabled("activityRemarks")} {...invalid("activityRemarks")} onChange={event => set("activityRemarks", event.target.value)}/><ErrorText name="activityRemarks"/></div>
    <div><Label>17. Auditee for the Activity *</Label><Select value={form.activityAuditeeId} disabled={readOnly || !form.auditeeId || ro("activityAuditeeId")} onValueChange={value => set("activityAuditeeId", value)}><SelectTrigger className="mt-2" {...invalid("activityAuditeeId")}><SelectValue placeholder="Select activity auditee"/></SelectTrigger><SelectContent>{form.auditeeId && <SelectItem value={form.auditeeId}>{users.find(user => user.id === form.auditeeId)?.fullName ?? "Selected auditee"}</SelectItem>}</SelectContent></Select><ErrorText name="activityAuditeeId"/></div>
    <div><Label>18. Date / Time of Activity *</Label><Input className="mt-2" type="datetime-local" value={form.activityDateTime.slice(0,16)} disabled={disabled("activityDateTime")} {...invalid("activityDateTime")} onChange={event => set("activityDateTime", event.target.value)}/><ErrorText name="activityDateTime"/></div>
    <div><Label>19. Audit Plan Circulation *</Label><Textarea className="mt-2" readOnly disabled={readOnly} value={circulation} {...invalid("circulation")} placeholder="Generated from selected Master users"/><ErrorText name="circulation"/></div>
    <DialogFooter><Button variant="outline" onClick={onClose}>{readOnly ? "Back to plans" : "Cancel"}</Button>{!readOnly && <Button onClick={save} disabled={create.isPending || update.isPending}>{initial ? "Save changes" : "Create Plan"}</Button>}</DialogFooter>
  </div>;
}

function Plans() {
  const [page, setPage] = useState(1); const [open, setOpen] = useState(false); const [search, setSearch] = useState("");
  const query = useListAuditPlans({ page, limit: PAGE_SIZE }); const schedules = useListAuditSchedules({ page: 1, limit: 100 }); const share = useShareAuditPlan(); const remove = useDeleteAuditPlan(); const qc = useQueryClient(); const { toast } = useToast();
  const items = (query.data?.items ?? []).filter(x => x.auditTitle.toLowerCase().includes(search.toLowerCase()));
  const refresh = (title: string) => { qc.invalidateQueries({ queryKey: ["/api/audit/plans"] }); toast({ title }); };
  return <div className="space-y-5"><PageHeader title="Audit plans" description="Define the Stage 2 Audit Planning programme" action={<Dialog open={open} onOpenChange={setOpen}><DialogTrigger asChild><Button><Plus className="mr-2 size-4"/>New plan</Button></DialogTrigger><DialogContent className="max-h-[90vh] max-w-3xl overflow-y-auto"><DialogHeader><DialogTitle>Create Audit Plan</DialogTitle></DialogHeader><PlanForm schedules={schedules.data?.items ?? []} onClose={() => setOpen(false)}/></DialogContent></Dialog>}/><Input className="max-w-sm" placeholder="Search audit title…" value={search} onChange={e => setSearch(e.target.value)}/><State loading={query.isLoading} error={query.error} empty={!items.length}/>
    <div className="grid gap-4 md:grid-cols-2">{items.map(plan => <Card key={plan.id}><CardHeader><div className="flex justify-between gap-2"><CardTitle className="text-base"><Link className="underline-offset-4 hover:underline" href={`/audit/plans/${plan.id}`}>{plan.auditTitle}</Link></CardTitle><Badge variant={workflowTone(plan.status)}>{plan.status}</Badge></div><CardDescription>{date(plan.startDateTime)} · {plan.activitySection}</CardDescription></CardHeader><CardContent className="space-y-3 text-sm"><p><b>Audit type:</b> {plan.auditTypes.join(", ")}</p><p><b>Team:</b> {plan.teamMemberIds.length} member(s)</p><p className="text-muted-foreground">{plan.description || plan.activityRemarks}</p><div className="flex justify-end gap-2"><Button size="sm" variant="outline" asChild><Link href={`/audit/plans/${plan.id}`}>{plan.status === "Draft" ? <Pencil className="mr-2 size-4"/> : <Eye className="mr-2 size-4"/>}{plan.status === "Draft" ? "Edit" : "View"}</Link></Button>{plan.status === "Draft" && <Button size="sm" onClick={() => share.mutate({ id: plan.id }, { onSuccess: () => refresh("Plan shared") })}><Share2 className="mr-2 size-4"/>Share</Button>}<Button size="icon" variant="ghost" onClick={() => window.confirm("Soft-delete this plan?") && remove.mutate({ id: plan.id }, { onSuccess: () => refresh("Plan deleted") })}><Trash2 className="size-4"/></Button></div></CardContent></Card>)}</div>{items.length > 0 && <Pager page={page} total={query.data?.total ?? 0} onPage={setPage}/>}</div>;
}

function PlanDetail() {
  const { id = "" } = useParams<{ id: string }>();
  const [, navigate] = useLocation();
  const query = useGetAuditPlan(id);
  const schedules = useListAuditSchedules({ page: 1, limit: 100 });
  if (query.isLoading || query.error || !query.data) return <div className="space-y-4"><Button variant="ghost" asChild><Link href="/audit/plans"><ArrowLeft className="mr-2 size-4"/>Audit plans</Link></Button><State loading={query.isLoading} error={query.error} empty={!query.data}/></div>;
  const plan = query.data;
  const editable = plan.status === "Draft";
  return <div className="space-y-5"><Button variant="ghost" asChild><Link href="/audit/plans"><ArrowLeft className="mr-2 size-4"/>Audit plans</Link></Button><PageHeader title={plan.auditTitle} description={editable ? "Draft Audit Plan · editable" : `${plan.status} Audit Plan · read-only`} action={<Badge variant={workflowTone(plan.status)}>{plan.status}</Badge>}/><Card><CardContent className="pt-6"><PlanForm initial={plan} readOnly={!editable} schedules={schedules.data?.items ?? []} onClose={() => navigate("/audit/plans")}/></CardContent></Card></div>;
}

function Audits() {
  const [page, setPage] = useState(1); const [search, setSearch] = useState(""); const query = useListAudits({ page, limit: PAGE_SIZE });
  const items = (query.data?.items ?? []).filter(x => x.title.toLowerCase().includes(search.toLowerCase()));
  return <div className="space-y-5"><PageHeader title="Audit execution" description="Open an audit to run meetings, checklist, findings and evidence"/><div className="relative max-w-sm"><Search className="absolute left-3 top-2.5 size-4 text-muted-foreground"/><Input className="pl-9" placeholder="Search audits…" value={search} onChange={e=>setSearch(e.target.value)}/></div><State loading={query.isLoading} error={query.error} empty={!items.length}/><div className="grid gap-4 md:grid-cols-2">{items.map(a => <Card key={a.id}><CardHeader><div className="flex justify-between"><CardTitle className="text-base">{a.title}</CardTitle><Badge variant={workflowTone(a.status)}>{a.status}</Badge></div><CardDescription>Started {date(a.startedAt)}</CardDescription></CardHeader><CardContent className="flex justify-end gap-2"><Button variant="outline" asChild><Link href={`/audit/audits/${a.id}/report`}>Report</Link></Button><Button asChild><Link href={`/audit/audits/${a.id}`}>Open workspace</Link></Button></CardContent></Card>)}</div>{items.length > 0 && <Pager page={page} total={query.data?.total ?? 0} onPage={setPage}/>}</div>;
}

function MeetingEditor({ auditId, kind, value }: { auditId: string; kind: "opening" | "closing"; value?: MeetingMinutes }) {
  const [form, setForm] = useState<MeetingMinutes>(value ?? { heldAt: "", attendees: [], minutes: "" }); const qc = useQueryClient(); const { toast } = useToast();
  const fa = useFieldAccess("audit"); const locked = fa.readOnly("audit-execution", `${kind}Meeting`);
  const opening = useUpdateAuditOpeningMeeting(); const closing = useUpdateAuditClosingMeeting();
  const save = () => { if (!form.heldAt || !form.minutes) { toast({ title: "Date and minutes are required", variant: "destructive" }); return; } const mutation = kind === "opening" ? opening : closing; mutation.mutate({ id: auditId, data: form }, { onSuccess: () => { qc.invalidateQueries({ queryKey: [`/api/audit/audits/${auditId}`] }); toast({ title: `${kind === "opening" ? "Opening" : "Closing"} minutes saved` }); } }); };
  return <Card><CardHeader><CardTitle className="capitalize">{kind} meeting minutes</CardTitle></CardHeader><CardContent className="space-y-4"><div><Label>Held at</Label><Input type="datetime-local" value={form.heldAt?.slice(0,16)} disabled={locked} onChange={e=>setForm(v=>({...v,heldAt:e.target.value}))}/></div><div><Label>Attendees (comma separated)</Label><Input value={form.attendees.join(", ")} disabled={locked} onChange={e=>setForm(v=>({...v,attendees:e.target.value.split(",").map(x=>x.trim()).filter(Boolean)}))}/></div><div><Label>Minutes</Label><Textarea rows={8} value={form.minutes} disabled={locked} onChange={e=>setForm(v=>({...v,minutes:e.target.value}))}/></div><Button onClick={save} disabled={locked}>Save minutes</Button></CardContent></Card>;
}

function Checklist({ auditId, initial }: { auditId: string; initial: ChecklistItem[] }) {
  const [items, setItems] = useState(initial); const mutation = useUpdateAuditChecklist(); const qc = useQueryClient(); const { toast } = useToast();
  const results = useLov("checklist_results");
  const add = () => setItems(v => [...v, { id: crypto.randomUUID(), question: "", result: "Not Applicable", notes: "" }]);
  const set = (i: number, key: keyof ChecklistItem, value: string) => setItems(v => v.map((x,n)=>n===i?{...x,[key]:value}:x));
  return <Card><CardHeader><div className="flex justify-between"><div><CardTitle>Interactive checklist</CardTitle><CardDescription>Record clause-level assessment results</CardDescription></div><Button variant="outline" onClick={add}><Plus className="mr-2 size-4"/>Item</Button></div></CardHeader><CardContent className="space-y-3">{items.length === 0 && <p className="py-8 text-center text-muted-foreground">No checklist items. Add the first one.</p>}{items.map((item,i)=><div key={item.id} className="grid gap-2 rounded-lg border p-3 md:grid-cols-[120px_1fr_180px_1fr_auto]"><Input placeholder="Clause" value={item.clause ?? ""} onChange={e=>set(i,"clause",e.target.value)}/><Input placeholder="Question" value={item.question} onChange={e=>set(i,"question",e.target.value)}/><Select value={item.result} disabled={results.isLoading} onValueChange={v=>set(i,"result",v)}><SelectTrigger><SelectValue/></SelectTrigger><SelectContent>{withLegacyOption(results.options,item.result).map(x=><SelectItem key={x.value} value={x.value}>{x.label}</SelectItem>)}</SelectContent></Select><Input placeholder="Notes" value={item.notes ?? ""} onChange={e=>set(i,"notes",e.target.value)}/><Button size="icon" variant="ghost" onClick={()=>setItems(v=>v.filter((_,n)=>n!==i))}><Trash2 className="size-4"/></Button></div>)}<Button disabled={mutation.isPending} onClick={()=>mutation.mutate({ id:auditId,data:items },{onSuccess:()=>{qc.invalidateQueries({queryKey:[`/api/audit/audits/${auditId}`]});toast({title:"Checklist saved"});}})}>Save checklist</Button></CardContent></Card>;
}

function FindingDialog({ auditId, initial, onClose }: { auditId: string; initial?: AuditFinding; onClose: () => void }) {
  const [form,setForm]=useState<AuditFinding>(initial ?? {id:crypto.randomUUID(),auditId,title:"",description:"",clause:"",classification:"Observation",priority:"P6",riskLevel:"Low",responsibleDepartments:[],status:"Open"});
  const fc=useFieldControls("audit","finding"); const ro=(key:string)=>fc.fieldProps(key).disabled; const req=(key:string)=>fc.fieldProps(key).required;
  const create=useCreateAuditFinding(); const update=useUpdateAuditFinding(); const qc=useQueryClient(); const {toast}=useToast(); const set=(k:keyof AuditFinding,v:unknown)=>setForm(x=>({...x,[k]:v}));
  const classifications=useLov("nc_classifications"); const priorities=useLov("finding_priorities"); const risks=useLov("risk_levels");
  const save=()=>{if(!form.title||!form.description||!form.responsibleDepartments.length){toast({title:"Title, description and department are required",variant:"destructive"});return;}const missing=fc.mandatoryFieldKeys().filter(key=>{const value=(form as unknown as Record<string,unknown>)[key];return Array.isArray(value)?!value.length:value==null||(typeof value==="string"&&!value.trim());});if(missing.length){toast({title:"Complete mandatory fields",description:`Required by your administrator: ${missing.join(", ")}`,variant:"destructive"});return;}const cb={onSuccess:()=>{qc.invalidateQueries({queryKey:["/api/audit/findings"]});toast({title:"Finding saved"});onClose();}};initial?update.mutate({id:initial.id,data:form},cb):create.mutate({data:form},cb)};
  return <div className="grid gap-3"><div><Label>Title *</Label><Input value={form.title} disabled={ro("title")} onChange={e=>set("title",e.target.value)}/></div><div><Label>Description *</Label><Textarea value={form.description} disabled={ro("description")} onChange={e=>set("description",e.target.value)}/></div><div><Label>Clause{req("clause") ? " *" : ""}</Label><Input value={form.clause??""} disabled={ro("clause")} onChange={e=>set("clause",e.target.value)}/></div><div className="grid grid-cols-3 gap-2">{([[classifications,form.classification,"classification"],[priorities,form.priority,"priority"],[risks,form.riskLevel,"riskLevel"]] as const).map(([lov,current,key])=><Select key={key} value={current} disabled={lov.isLoading || ro(key)} onValueChange={v=>set(key,v)}><SelectTrigger><SelectValue/></SelectTrigger><SelectContent>{withLegacyOption(lov.options,current).map(x=><SelectItem value={x.value} key={x.value}>{x.label}</SelectItem>)}</SelectContent></Select>)}</div><div><Label>Responsible departments *</Label><Input value={form.responsibleDepartments.join(", ")} disabled={ro("responsibleDepartments")} onChange={e=>set("responsibleDepartments",e.target.value.split(",").map(x=>x.trim()).filter(Boolean))}/></div><DialogFooter><Button variant="outline" onClick={onClose}>Cancel</Button><Button onClick={save}>Save finding</Button></DialogFooter></div>;
}

function Findings({ auditId }: { auditId: string }) {
  const query=useListAuditFindings({page:1,limit:100}); const cars=useListCorrectiveActionReports({page:1,limit:100}); const [open,setOpen]=useState(false); const [edit,setEdit]=useState<AuditFinding>(); const raise=useCreateFindingCars(); const qc=useQueryClient(); const {toast}=useToast();
  const items=(query.data?.items??[]).filter(x=>x.auditId===auditId);
  const raiseCars=(finding:AuditFinding)=>{const existing=new Set((cars.data?.items??[]).filter(c=>c.findingId===finding.id).map(c=>c.responsibleDepartment));const available=finding.responsibleDepartments.filter(d=>!existing.has(d));if(!available.length){toast({title:"CARs already exist for all departments"});return;}raise.mutate({id:finding.id,data:{responsibleDepartments:available}},{onSuccess:()=>{qc.invalidateQueries({queryKey:["/api/audit/cars"]});toast({title:`Raised ${available.length} CAR(s)`});}})};
  return <div className="space-y-4"><div className="flex justify-end"><Button onClick={()=>{setEdit(undefined);setOpen(true)}}><Plus className="mr-2 size-4"/>New finding</Button></div><Dialog open={open} onOpenChange={setOpen}><DialogContent><DialogHeader><DialogTitle>{edit?"Edit":"Create"} finding</DialogTitle></DialogHeader><FindingDialog auditId={auditId} initial={edit} onClose={()=>setOpen(false)}/></DialogContent></Dialog><State loading={query.isLoading} error={query.error} empty={!items.length}/>{items.map(f=><Card key={f.id}><CardContent className="pt-5"><div className="flex flex-wrap items-start justify-between gap-3"><div><div className="flex gap-2"><Badge>{f.classification}</Badge><Badge variant="outline">{f.priority}</Badge><Badge variant={f.riskLevel==="High"?"destructive":"secondary"}>{f.riskLevel} risk</Badge></div><h3 className="mt-3 font-semibold">{f.title}</h3><p className="mt-1 text-sm text-muted-foreground">{f.description}</p><p className="mt-2 text-xs">Departments: {f.responsibleDepartments.join(", ")}</p><p className="mt-1 text-xs text-muted-foreground">Existing CARs: {(cars.data?.items??[]).filter(c=>c.findingId===f.id).map(c=>c.responsibleDepartment).join(", ")||"None"}</p></div><div className="flex gap-2"><Button variant="outline" size="sm" onClick={()=>{setEdit(f);setOpen(true)}}>Edit</Button>{f.classification.includes("NC")&&<Button size="sm" onClick={()=>raiseCars(f)}>Raise CAR</Button>}</div></div></CardContent></Card>)}</div>;
}

function Evidence({ auditId }: { auditId: string }) {
  const query=useListAuditEvidence({recordType:"audit",recordId:auditId,page:1,limit:100}); const intent=useCreateAuditEvidenceIntent(); const confirm=useConfirmAuditEvidence(); const qc=useQueryClient(); const {toast}=useToast();
  const upload=async(file:File)=>{const max=file.type.startsWith("video/")?200:file.type.startsWith("image/")?8:25;if(file.size>max*1024*1024){toast({title:`File exceeds ${max}MB limit`,variant:"destructive"});return;}intent.mutate({data:{recordType:"audit",recordId:auditId,category:file.type.split("/")[0]||"document",fileName:file.name,mimeType:file.type||"application/octet-stream",sizeBytes:file.size,clientReference:crypto.randomUUID()}},{onSuccess:async data=>{try{const response=await fetch(data.uploadUrl,{method:"PUT",body:file,headers:{"Content-Type":file.type||"application/octet-stream"}});if(!response.ok)throw new Error("Storage upload failed");confirm.mutate({id:data.id},{onSuccess:()=>{qc.invalidateQueries({queryKey:["/api/audit/evidence"]});toast({title:"Evidence uploaded"});}})}catch(e){toast({title:"Upload failed",description:errorText(e),variant:"destructive"})}}})};
  return <Card><CardHeader><div className="flex justify-between"><div><CardTitle>Evidence files</CardTitle><CardDescription>Photos ≤8MB · video ≤200MB / 3min · documents ≤25MB</CardDescription></div><Button asChild><Label className="cursor-pointer"><Upload className="mr-2 size-4"/>Upload<input className="hidden" type="file" onChange={e=>e.target.files?.[0]&&upload(e.target.files[0])}/></Label></Button></div></CardHeader><CardContent><State loading={query.isLoading} error={query.error} empty={!query.data?.items.length}/><div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">{query.data?.items.map(file=><div key={file.id} className="flex items-center gap-3 rounded-lg border p-3"><div className="rounded bg-muted p-2"><FileText className="size-5"/></div><div className="min-w-0"><p className="truncate text-sm font-medium">{file.fileName}</p><p className="text-xs text-muted-foreground">{(file.sizeBytes/1024/1024).toFixed(1)}MB · {file.status}</p></div></div>)}</div></CardContent></Card>;
}

function AuditWorkspace() {
  const {id=""}=useParams<{id:string}>(); const query=useGetAudit(id);
  if(query.isLoading||query.error||!query.data)return <div className="space-y-4"><Button variant="ghost" asChild><Link href="/audit/audits"><ArrowLeft className="mr-2 size-4"/>Audits</Link></Button><State loading={query.isLoading} error={query.error} empty={!query.data}/></div>;
  const audit=query.data;
  return <div className="space-y-5"><Button variant="ghost" asChild><Link href="/audit/audits"><ArrowLeft className="mr-2 size-4"/>All audits</Link></Button><PageHeader title={audit.title} description={`Execution workspace · ${audit.status}`} action={<Button variant="outline" asChild><Link href={`/audit/audits/${id}/report`}>View report</Link></Button>}/><Tabs defaultValue="overview"><TabsList className="h-auto flex-wrap"><TabsTrigger value="overview">Overview</TabsTrigger><TabsTrigger value="checklist">Checklist</TabsTrigger><TabsTrigger value="opening">Opening meeting</TabsTrigger><TabsTrigger value="closing">Closing meeting</TabsTrigger><TabsTrigger value="findings">Findings</TabsTrigger><TabsTrigger value="evidence">Evidence</TabsTrigger></TabsList>
    <TabsContent value="overview"><Card><CardHeader><CardTitle>Audit overview</CardTitle></CardHeader><CardContent className="grid gap-4 sm:grid-cols-3"><div><Label>Status</Label><p><Badge>{audit.status}</Badge></p></div><div><Label>Project</Label><p>{audit.projectId}</p></div><div><Label>Plan</Label><p>{audit.planId}</p></div><div><Label>Started</Label><p>{date(audit.startedAt)}</p></div><div><Label>Closed</Label><p>{date(audit.closedAt)}</p></div><div><Label>Checklist</Label><p>{audit.checklist?.length??0} items</p></div></CardContent></Card></TabsContent>
    <TabsContent value="checklist"><Checklist auditId={id} initial={audit.checklist??[]}/></TabsContent><TabsContent value="opening"><MeetingEditor auditId={id} kind="opening" value={audit.openingMeeting}/></TabsContent><TabsContent value="closing"><MeetingEditor auditId={id} kind="closing" value={audit.closingMeeting}/></TabsContent><TabsContent value="findings"><Findings auditId={id}/></TabsContent><TabsContent value="evidence"><Evidence auditId={id}/></TabsContent></Tabs></div>;
}

function CarEditor({car,onClose}:{car:CorrectiveActionReport;onClose:()=>void}) {
  const [form,setForm]=useState(car);const mutation=useUpdateCorrectiveActionReport();const qc=useQueryClient();const {toast}=useToast();
  const fc=useFieldControls("audit","car"); const ro=(key:string)=>fc.fieldProps(key).disabled; const req=(key:string)=>fc.fieldProps(key).required;
  const save=()=>{const missing=fc.mandatoryFieldKeys().filter(key=>{const value=(form as unknown as Record<string,unknown>)[key];return value==null||(typeof value==="string"&&!value.trim());});if(missing.length){toast({title:"Complete mandatory fields",description:`Required by your administrator: ${missing.join(", ")}`,variant:"destructive"});return;}mutation.mutate({id:car.id,data:form},{onSuccess:()=>{qc.invalidateQueries({queryKey:["/api/audit/cars"]});toast({title:"CAR updated"});onClose();}})};
  return <div className="space-y-3"><div><Label>Root cause{req("rootCause") ? " *" : ""}</Label><Textarea value={form.rootCause??""} disabled={ro("rootCause")} onChange={e=>setForm(v=>({...v,rootCause:e.target.value}))}/></div><div><Label>Correction{req("correction") ? " *" : ""}</Label><Textarea value={form.correction??""} disabled={ro("correction")} onChange={e=>setForm(v=>({...v,correction:e.target.value}))}/></div><div><Label>Corrective action{req("correctiveAction") ? " *" : ""}</Label><Textarea value={form.correctiveAction??""} disabled={ro("correctiveAction")} onChange={e=>setForm(v=>({...v,correctiveAction:e.target.value}))}/></div><DialogFooter><Button variant="outline" onClick={onClose}>Cancel</Button><Button onClick={save}>Save response</Button></DialogFooter></div>;
}

function Cars() {
  const [page,setPage]=useState(1);const [status,setStatus]=useState("all");const [edit,setEdit]=useState<CorrectiveActionReport>();const query=useListCorrectiveActionReports({page,limit:PAGE_SIZE,...(status==="all"?{}:{status})});const qc=useQueryClient();const {toast}=useToast();
  const submit=useSubmitCorrectiveActionReport(),review=useReviewCorrectiveActionReport(),extension=useRequestCarExtension(),extensionReview=useReviewCarExtension(),extensionCancel=useCancelCarExtension(),close=useCloseCorrectiveActionReport();
  const refresh=(title:string)=>{qc.invalidateQueries({queryKey:["/api/audit/cars"]});toast({title})};
  const requestExtension=(id:string)=>{const requestedDueDate=window.prompt("New due date (YYYY-MM-DD)");if(!requestedDueDate)return;const reason=window.prompt("Justification (required)");if(!reason?.trim()){toast({title:"Justification is required",variant:"destructive"});return;}extension.mutate({id,data:{requestedDueDate,reason}},{onSuccess:()=>refresh("Extension requested")})};
  return <div className="space-y-5"><PageHeader title="Corrective Action Register" description="Track ownership, response, review, extensions and closure"/><Select value={status} onValueChange={v=>{setStatus(v);setPage(1)}}><SelectTrigger className="w-52"><SelectValue/></SelectTrigger><SelectContent>{["all","Open","Draft","Submitted","Accepted","Rejected","Extension Requested","Closed"].map(x=><SelectItem key={x} value={x}>{x==="all"?"All statuses":x}</SelectItem>)}</SelectContent></Select><State loading={query.isLoading} error={query.error} empty={!query.data?.items.length}/><Dialog open={!!edit} onOpenChange={v=>!v&&setEdit(undefined)}><DialogContent><DialogHeader><DialogTitle>CAR response</DialogTitle></DialogHeader>{edit&&<CarEditor car={edit} onClose={()=>setEdit(undefined)}/>}</DialogContent></Dialog>
    <div className="space-y-3">{query.data?.items.map(car=>{const overdue=car.status!=="Closed"&&new Date(car.dueDate)<new Date();return <Card key={car.id} className={overdue?"border-destructive":""}><CardContent className="pt-5"><div className="flex flex-wrap items-start justify-between gap-4"><div><div className="flex flex-wrap gap-2"><Badge variant={workflowTone(car.status)}>{car.status}</Badge>{overdue&&<Badge variant="destructive">Overdue · priority may auto-upgrade</Badge>}{car.extensionStatus&&<Badge variant="outline">Extension {car.extensionStatus}</Badge>}</div><h3 className="mt-3 font-semibold">{car.responsibleDepartment}</h3><p className="text-sm text-muted-foreground">Due {date(car.dueDate)} · Owner {car.ownerId}</p><p className="mt-2 text-sm"><b>Root cause:</b> {car.rootCause||"Not provided"}</p></div><div className="flex max-w-lg flex-wrap justify-end gap-2"><Button size="sm" variant="outline" onClick={()=>setEdit(car)}>Edit response</Button>{["Open","Draft","Rejected"].includes(car.status)&&<Button size="sm" onClick={()=>submit.mutate({id:car.id},{onSuccess:()=>refresh("CAR submitted")})}>Submit</Button>}{car.status==="Submitted"&&<><Button size="sm" onClick={()=>review.mutate({id:car.id,data:{decision:"accept"}},{onSuccess:()=>refresh("CAR accepted")})}>Accept</Button><Button size="sm" variant="outline" onClick={()=>{const comments=window.prompt("Rejection remarks");review.mutate({id:car.id,data:{decision:"reject",comments}},{onSuccess:()=>refresh("CAR rejected")})}}>Reject</Button></>}{car.status==="Accepted"&&car.extensionStatus!=="pending"&&<Button size="sm" variant="outline" onClick={()=>requestExtension(car.id)}>Extension</Button>}{car.extensionStatus==="pending"&&<><Button size="sm" onClick={()=>extensionReview.mutate({id:car.id,data:{decision:"approve"}},{onSuccess:()=>refresh("Extension approved")})}>Approve extension</Button><Button size="sm" variant="outline" onClick={()=>{const comments=window.prompt("Rejection remarks (required)");if(!comments?.trim())return;extensionReview.mutate({id:car.id,data:{decision:"reject",comments}},{onSuccess:()=>refresh("Extension rejected")})}}>Reject extension</Button><Button size="sm" variant="ghost" onClick={()=>window.confirm("Withdraw this extension request? The CAR returns to its previous step.")&&extensionCancel.mutate({id:car.id},{onSuccess:()=>refresh("Extension withdrawn")})}>Withdraw</Button></>}{car.status==="Accepted"&&<Button size="sm" onClick={()=>window.confirm("Verify effectiveness and close this CAR?")&&close.mutate({id:car.id},{onSuccess:()=>refresh("CAR closed")})}>Close</Button>}</div></div></CardContent></Card>})}</div>{query.data?.items.length?<Pager page={page} total={query.data.total} onPage={setPage}/>:null}</div>;
}

const reportCards=[["Open vs closed audits","open-vs-closed"],["Findings log","findings-log"],["Audit ageing","ageing"],["CAR status & closure","car-status"],["Annual audit schedule","schedule"]];
function Reports() {
  return <div className="space-y-5"><PageHeader title="Report centre" description="Operational audit reports and export files"/><div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">{reportCards.map(([title,path])=><Card key={path}><CardHeader><div className="mb-2 w-fit rounded-lg bg-accent p-2 text-accent-foreground"><BarChart3 className="size-5"/></div><CardTitle className="text-base">{title}</CardTitle><CardDescription>Current live audit workspace data</CardDescription></CardHeader><CardContent><Button variant="outline" className="w-full" asChild><a href={`/api/audit/reports/${path}?format=csv`} download><Download className="mr-2 size-4"/>Download CSV</a></Button></CardContent></Card>)}</div></div>;
}

function AuditReport() {
  const {id=""}=useParams<{id:string}>();const query=useGetGeneratedAuditReport(id);
  if(query.isLoading||query.error||!query.data)return <State loading={query.isLoading} error={query.error} empty={!query.data}/>;
  const r=query.data;
  return <div className="space-y-5 print:p-0"><div className="flex justify-between print:hidden"><Button variant="ghost" asChild><Link href={`/audit/audits/${id}`}><ArrowLeft className="mr-2 size-4"/>Workspace</Link></Button><div className="flex gap-2"><Button variant="outline" asChild><a href={`/api/audit/audits/${id}/report?format=csv`} download><Download className="mr-2 size-4"/>CSV</a></Button><Button onClick={()=>window.print()}><Printer className="mr-2 size-4"/>Print</Button></div></div><Card><CardHeader className="border-b bg-primary text-primary-foreground"><CardTitle className="text-2xl">Audit Report</CardTitle><CardDescription className="text-primary-foreground/80">Generated {new Date(r.generatedAt).toLocaleString()}</CardDescription></CardHeader><CardContent className="space-y-8 pt-6"><section><h2 className="text-xl font-semibold">{r.audit.title}</h2><div className="mt-3 grid gap-2 text-sm sm:grid-cols-3"><p><b>Status:</b> {r.audit.status}</p><p><b>Project:</b> {r.audit.projectId}</p><p><b>Started:</b> {date(r.audit.startedAt)}</p></div></section>
    <section className="grid gap-4 md:grid-cols-2">{[["Opening meeting",r.audit.openingMeeting],["Closing meeting",r.audit.closingMeeting]].map(([name,m])=>{const meeting=m as MeetingMinutes|undefined;return <div key={name as string} className="rounded-lg border p-4"><h3 className="font-semibold">{name as string}</h3>{meeting?<><p className="mt-1 text-sm">{date(meeting.heldAt)} · {meeting.attendees.join(", ")}</p><p className="mt-2 whitespace-pre-wrap text-sm text-muted-foreground">{meeting.minutes}</p></>:<p className="mt-2 text-sm text-muted-foreground">Not recorded.</p>}</div>})}</section>
    <section><h3 className="mb-3 font-semibold">Findings</h3>{r.findings.length?<Table><TableHeader><TableRow><TableHead>Finding</TableHead><TableHead>Classification</TableHead><TableHead>Priority / Risk</TableHead><TableHead>Status</TableHead></TableRow></TableHeader><TableBody>{r.findings.map(f=><TableRow key={f.id}><TableCell><b>{f.title}</b><p className="text-xs text-muted-foreground">{f.description}</p></TableCell><TableCell>{f.classification}</TableCell><TableCell>{f.priority} / {f.riskLevel}</TableCell><TableCell>{f.status}</TableCell></TableRow>)}</TableBody></Table>:<p className="text-sm text-muted-foreground">No findings.</p>}</section>
    <section><h3 className="mb-3 font-semibold">Corrective Action Reports</h3>{r.cars.length?<Table><TableHeader><TableRow><TableHead>Department</TableHead><TableHead>Due</TableHead><TableHead>Root cause</TableHead><TableHead>Status</TableHead></TableRow></TableHeader><TableBody>{r.cars.map(c=><TableRow key={c.id}><TableCell>{c.responsibleDepartment}</TableCell><TableCell>{date(c.dueDate)}</TableCell><TableCell>{c.rootCause||"—"}</TableCell><TableCell>{c.status}</TableCell></TableRow>)}</TableBody></Table>:<p className="text-sm text-muted-foreground">No CARs.</p>}</section></CardContent></Card></div>;
}

function Missing() { return <Card><CardContent className="py-14 text-center"><XCircle className="mx-auto mb-3 size-8 text-muted-foreground"/><h2 className="font-semibold">Audit page not found</h2><Button className="mt-4" asChild><Link href="/audit">Return to dashboard</Link></Button></CardContent></Card>; }

function AuditPlanAutoSync() {
  const qc = useQueryClient();
  const { toast } = useToast();
  useEffect(() => {
    const sync = async () => {
      const result = await syncQueuedAuditPlans();
      if (result.synced) {
        qc.invalidateQueries({ queryKey: ["/api/audit/plans"] });
        toast({ title: `${result.synced} offline Audit Plan${result.synced === 1 ? "" : "s"} synchronized` });
      }
      if (result.failed) toast({ title: "Some offline Audit Plans could not be synchronized", description: "They remain safely stored on this device and will be retried.", variant: "destructive" });
    };
    void sync();
    window.addEventListener("online", sync);
    return () => window.removeEventListener("online", sync);
  }, [qc, toast]);
  return null;
}

export function AuditRoutes() {
  return <Layout><AuditPlanAutoSync/><Switch>
    <Route path="/audit" component={Dashboard}/>
    <Route path="/audit/schedules/:parentId" component={Schedules}/>
    <Route path="/audit/schedules" component={Programmes}/>
    <Route path="/audit/plans/:id" component={PlanDetail}/>
    <Route path="/audit/plans" component={Plans}/>
    <Route path="/audit/audits/:id/report" component={AuditReport}/>
    <Route path="/audit/audits/:id" component={AuditWorkspace}/>
    <Route path="/audit/audits" component={Audits}/>
    <Route path="/audit/cars" component={Cars}/>
    <Route path="/audit/reports" component={Reports}/>
    <Route><Missing/></Route>
  </Switch></Layout>;
}