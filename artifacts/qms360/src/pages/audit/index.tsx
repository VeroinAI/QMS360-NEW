import { useEffect, useRef, useState } from "react";
import { Link, Route, Switch, useLocation, useParams } from "wouter";
import { useQueryClient } from "@tanstack/react-query";
import {
  customFetch,
  useCloseCorrectiveActionReport,
  useConfirmAuditEvidence,
  useCreateAuditEvidenceIntent,
  useCreateAuditChecklistItem,
  useEditAuditChecklistItem,
  useImportAuditChecklistItems,
  useCreateAuditFinding,
  useCreateAuditPlan,
  useCreateAuditSchedule,
  useCreateFindingCars,
  useDeleteAuditPlan,
  useDeleteAuditProgramme,
  useDeleteAuditSchedule,
  useGetAudit,
  getGetAuditQueryKey,
  useGetAuditSchedule,
  useGetCorrectiveActionReport,
  getGetCorrectiveActionReportQueryKey,
  useGetAuditDashboard,
  useGetAuditPlan,
  getGetAuditPlanQueryKey,
  useGetAuditPlanOptions,
  useListAuditTeamLeads,
  useListAuditMeetingAttendees,
  useListAuditProcessProductOwners,
  listAuditProcessProductOwners,
  useGetAuditProgramme,
  getGetAuditProgrammeQueryKey,
  getListAuditProgrammesQueryKey,
  getAuditProgrammeSignatories,
  getMasterDataLov,
  listAuditSchedules,
  listPlatformProjects,
  useGetGeneratedAuditReport,
  useListAuditEvidence,
  useListAuditFindings,
  useListAuditPlanNotificationRoles,
  useListAuditPlans,
  useListAuditMyActions,
  useListAuditSchedules,
  useListAuditProgrammes,
  useCreateAuditProgramme,
  useSubmitAuditProgramme,
  useSubmitAuditSchedule,
  useReviewAuditProgramme,
  useListAudits,
  useListCorrectiveActionReports,
  useListPlatformProjects,
  useCancelCarExtension,
  useRequestCarExtension,
  useRecordAuditScheduleFeasibility,
  useReviewAuditSchedule,
  useReviewCarExtension,
  useReviewCorrectiveActionReport,
  useSendAuditPlanForExecution,
  useSubmitCorrectiveActionReport,
  useUpdateAuditChecklist,
  useUpdateAuditClosingMeeting,
  useUpdateAuditFinding,
  useUpdateAuditOpeningMeeting,
  useUpdateAuditPlan,
  useUpdateCorrectiveActionReport,
  useUpdateAuditSchedule,
  useUpdateAuditProgrammeTeamLeads,
} from "@workspace/api-client-react";
import type {
  AuditFinding,
  AuditPlan,
  AuditPlanActivity,
  AuditProgramme,
  AuditProgrammePage,
  AuditSchedule,
  ChecklistItem,
  CorrectiveActionReport,
  MeetingMinutes,
} from "@workspace/api-client-react";
import {
  AlertTriangle, ArrowLeft, BarChart3, CalendarDays, CheckCircle2, ChevronDown, ClipboardCheck,
  Download, Eye, FileText, FolderOpen, Pencil, Plus, Printer, Search, Send, ShieldCheck,
  Check, Info, Trash2, Upload, XCircle,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { useGetAuditEscalations } from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { DropdownMenu, DropdownMenuCheckboxItem, DropdownMenuContent, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Progress } from "@/components/ui/progress";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import * as XLSX from "xlsx";
import { downloadScheduleWorkbook, resolveScheduleProject, scheduleCategoryLinkError, scheduleFieldForHeader } from "./schedule-workbook";
import { checklistFindings, downloadChecklistWorkbook, parseChecklistWorkbook } from "./checklist-workbook";
import { useLov, withLegacyOption } from "@/lib/use-lov";
import { categoryOptionsForAuditType } from "./audit-category-options";
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
type ProgrammeRange = { fromDate: string; toDate: string };
const PROCESS_AUDIT_TYPE = "Quality Internal Process Audit";
const PRODUCT_AUDIT_TYPE = "Quality Internal Product Audit";
type ProgrammeSignatory = {
  userId: string;
  name: string;
  designation: string | null;
  role: string;
  signatureDataUrl: string | null;
};
export type ProgrammeSignatories = {
  preparedBy: ProgrammeSignatory | null;
  reviewedBy: ProgrammeSignatory[];
  approvedBy: ProgrammeSignatory | null;
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
  const weekMs = 7 * 24 * 60 * 60 * 1000;
  const isoYearStart = (isoYear: number) => {
    const januaryFourth = new Date(Date.UTC(isoYear, 0, 4));
    const daysSinceMonday = (januaryFourth.getUTCDay() + 6) % 7;
    return Date.UTC(isoYear, 0, 4 - daysSinceMonday);
  };
  const startTime = isoYearStart(year);
  const endTime = isoYearStart(year + 1);
  const totalSlots = Math.round((endTime - startTime) / weekMs);
  const labels = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
  const monthBoundary = (month: number) => Math.max(0, Math.min(totalSlots, (Date.UTC(year, month, 1) - startTime) / weekMs));
  const monthStartSlots = labels.map((_, index) => index === 0 ? 0 : monthBoundary(index));
  const months = labels.map((label, index) => {
    const startSlot = monthStartSlots[index];
    const endSlot = index === labels.length - 1 ? totalSlots : monthBoundary(index + 1);
    return { label, weeks: endSlot - startSlot };
  });
  const weekNumbers = Array.from({ length: totalSlots }, (_, index) => index + 1);
  return { months, monthStartSlots, totalSlots, weekNumbers, startTime, weekMs };
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
  const dateTime = Date.UTC(parsed.year, parsed.month, parsed.day);
  if (dateTime < timeline.startTime) return 0;
  if (dateTime >= timeline.startTime + timeline.totalSlots * timeline.weekMs) return timeline.totalSlots;
  return (dateTime - timeline.startTime + (end ? 24 * 60 * 60 * 1000 : 0)) / timeline.weekMs;
};
const stableScheduleId = async (parentId: string, row: Record<string, unknown>) => {
  const input = new TextEncoder().encode(`${parentId}\n${JSON.stringify(row)}`);
  const bytes = new Uint8Array(await crypto.subtle.digest("SHA-256", input));
  bytes[6] = (bytes[6] & 0x0f) | 0x50;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = Array.from(bytes.slice(0, 16), byte => byte.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
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
export const buildProgrammePdf = (rows: AuditSchedule[], auditTitle: string, signatories?: ProgrammeSignatories) => {
  const year = rows[0]?.year ?? new Date().getFullYear();
  const timeline = programmeTimeline(year);
  const fixedHeaders = [
    "Business Category", "Department / Project", "Process Owner", "Audit Number / Site Visit No",
    "QA/QC Reference", "QA/QC Scope", "QA/QC Clauses",
  ];
  const pageWidth = 1684;
  const pageHeight = 1191;
  const margin = 18;
  const titleHeight = 44;
  const headerHeight = 42;
  const signatureFooterHeight = signatories
    ? Math.max(112, 30 + (signatories.reviewedBy?.length ?? 0) * 62)
    : 0;
  const minimumRowHeight = 34;
  const fixedWidths = [105, 135, 100, 120, 105, 180, 130];
  const remarksWidth = 130;
  const fixedWidth = fixedWidths.reduce((sum, width) => sum + width, 0);
  const timelineWidth = pageWidth - margin * 2 - fixedWidth - remarksWidth;
  const weekWidth = timelineWidth / timeline.totalSlots;
  const escapePdf = (value: string) => value
    .normalize("NFKD")
    .replace(/\\/g, "\\\\").replace(/\(/g, "\\(").replace(/\)/g, "\\)")
    .replace(/\u2013/g, "\\226").replace(/\u2014/g, "\\227")
    .replace(/\u2018/g, "\\221").replace(/\u2019/g, "\\222")
    .replace(/\u201c/g, "\\223").replace(/\u201d/g, "\\224")
    .replace(/\u2022/g, "\\225").replace(/\u2026/g, "\\205")
    .replace(/[^\x20-\x7E]/g, "");
  const text = (value: unknown, x: number, y: number, size = 5.5, bold = false) =>
    `0 0 0 rg BT /${bold ? "F2" : "F1"} ${size} Tf ${x.toFixed(2)} ${y.toFixed(2)} Td (${escapePdf(String(value ?? ""))}) Tj ET\n`;
  const centeredText = (value: unknown, x: number, y: number, width: number, size = 5, bold = false) => {
    const raw = escapePdf(String(value ?? "").trim());
    const estimatedWidth = raw.length * size * 0.52;
    return text(raw, x + Math.max(1, (width - estimatedWidth) / 2), y, size, bold);
  };
  const wrapText = (value: unknown, width: number, size = 5) => {
    const maxCharacters = Math.max(1, Math.floor((width - 6) / (size * 0.52)));
    const lines: string[] = [];
    String(value ?? "").trim().split(/\r?\n/).forEach(paragraph => {
      const words = paragraph.split(/\s+/).filter(Boolean);
      if (words.length === 0) {
        if (lines.length > 0) lines.push("");
        return;
      }
      let line = "";
      words.forEach(word => {
        const chunks = word.length > maxCharacters
          ? word.match(new RegExp(`.{1,${maxCharacters}}`, "g")) ?? [word]
          : [word];
        chunks.forEach(chunk => {
          const candidate = line ? `${line} ${chunk}` : chunk;
          if (candidate.length <= maxCharacters) {
            line = candidate;
          } else {
            if (line) lines.push(line);
            line = chunk;
          }
        });
      });
      if (line) lines.push(line);
    });
    return lines.length > 0 ? lines : [""];
  };
  const wrappedText = (value: unknown, x: number, y: number, width: number, height: number, size = 5) => {
    const lines = wrapText(value, width, size);
    const lineHeight = size + 2;
    const firstBaseline = y + height / 2 + ((lines.length - 1) * lineHeight) / 2 - size * 0.35;
    return lines.map((line, index) => text(line, x + 3, firstBaseline - index * lineHeight, size)).join("");
  };
  const rect = (x: number, y: number, width: number, height: number, fill?: [number, number, number]) =>
    `${fill ? `${fill.join(" ")} rg ${x.toFixed(2)} ${y.toFixed(2)} ${width.toFixed(2)} ${height.toFixed(2)} re f\n` : ""}0.45 G 0.35 w ${x.toFixed(2)} ${y.toFixed(2)} ${width.toFixed(2)} ${height.toFixed(2)} re S\n`;
  const preparedRows = rows.map((item, index) => {
    const values = [
      item.auditCategory, item.departmentProject, item.processProductOwner, item.auditNumber,
      item.qaqcReference, item.qaqcScope, item.qaqcClauses,
    ];
    const lineCount = Math.max(
      ...values.map((value, valueIndex) => wrapText(value, fixedWidths[valueIndex], 5).length),
      wrapText(item.remarks, remarksWidth, 5).length,
    );
    return { item, index, values, height: Math.max(minimumRowHeight, lineCount * 7 + 10) };
  });
  const tableTop = pageHeight - margin - titleHeight;
  const headerBottom = tableTop - headerHeight;
  const availableRowHeight = headerBottom - margin;
  const rowPages: typeof preparedRows[] = [];
  preparedRows.forEach(row => {
    const currentPage = rowPages.at(-1);
    const currentHeight = currentPage?.reduce((sum, item) => sum + item.height, 0) ?? 0;
    if (!currentPage || (currentPage.length > 0 && currentHeight + row.height > availableRowHeight)) rowPages.push([row]);
    else currentPage.push(row);
  });
  if (rowPages.length === 0) rowPages.push([]);
  if (signatories) {
    const lastPage = rowPages.at(-1)!;
    const footerRowCapacity = availableRowHeight - signatureFooterHeight;
    let lastPageHeight = lastPage.reduce((sum, item) => sum + item.height, 0);
    const movedRows: typeof preparedRows = [];
    while (lastPage.length > 0 && lastPageHeight > footerRowCapacity) {
      const row = lastPage.at(-1)!;
      if (lastPageHeight - row.height < 0) break;
      lastPage.pop();
      movedRows.unshift(row);
      lastPageHeight -= row.height;
    }
    if (movedRows.length > 0) {
      if (lastPage.length === 0) rowPages.pop();
      rowPages.push(movedRows);
      if (movedRows.reduce((sum, item) => sum + item.height, 0) > footerRowCapacity) rowPages.push([]);
    } else if (lastPageHeight > footerRowCapacity) rowPages.push([]);
  }
  const signatureImages = Array.from(new Set([
    signatories?.preparedBy,
    ...(signatories?.reviewedBy ?? []),
    signatories?.approvedBy,
  ].filter((person): person is ProgrammeSignatory => Boolean(person?.signatureDataUrl))
    .map(person => person.signatureDataUrl!)))
    .map(dataUrl => {
      const match = /^data:image\/jpeg;base64,([A-Za-z0-9+/]+=*)$/.exec(dataUrl);
      if (!match) throw new Error("Programme signatures must be converted to JPEG before PDF generation.");
      const bytes = Uint8Array.from(atob(match[1]), character => character.charCodeAt(0));
      return { dataUrl, bytes, stream: ascii85Encode(bytes) };
    });
  const pages: string[] = [];
  const pageCount = rowPages.length;
  for (let pageIndex = 0; pageIndex < pageCount; pageIndex += 1) {
    let content = "";
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
      content += centeredText(`W${timeline.weekNumbers[week]}`, weekX, headerBottom + 7, weekWidth, 3.8, false);
    });
    const remarksX = timelineX + timelineWidth;
    content += rect(remarksX, headerBottom, remarksWidth, headerHeight, [0.91, 0.89, 0.95]);
    content += centeredText("Remarks", remarksX, headerBottom + 18, remarksWidth, 5.4, true);
    let nextRowTop = headerBottom;
    rowPages[pageIndex].forEach(({ item, index: sourceIndex, values, height: rowHeight }) => {
      const y = nextRowTop - rowHeight;
      let cellX = margin;
      values.forEach((value, index) => {
        content += rect(cellX, y, fixedWidths[index], rowHeight, sourceIndex % 2 ? [0.98, 0.98, 0.99] : undefined);
        content += wrappedText(value, cellX, y, fixedWidths[index], rowHeight, 5);
        cellX += fixedWidths[index];
      });
      Array.from({ length: timeline.totalSlots }, (_, week) => {
        content += rect(timelineX + week * weekWidth, y, weekWidth, rowHeight, sourceIndex % 2 ? [0.98, 0.98, 0.99] : undefined);
      });
      const start = Math.max(0, Math.min(timeline.totalSlots, programmeTimelinePosition(item.plannedStartDate, year, false, timeline)));
      const end = Math.max(0, Math.min(timeline.totalSlots, programmeTimelinePosition(item.plannedEndDate, year, true, timeline)));
      const barWidth = Math.max(0, end - start) * weekWidth;
      if (barWidth > 0) {
        content += `0.10 0.32 0.58 rg ${(timelineX + start * weekWidth).toFixed(2)} ${(y + 8).toFixed(2)} ${Math.max(2, barWidth).toFixed(2)} ${(rowHeight - 16).toFixed(2)} re f\n`;
      }
      content += rect(remarksX, y, remarksWidth, rowHeight, sourceIndex % 2 ? [0.98, 0.98, 0.99] : undefined);
      content += wrappedText(item.remarks, remarksX, y, remarksWidth, rowHeight, 5);
      nextRowTop = y;
    });
    if (signatories && pageIndex === pageCount - 1) {
      const footerY = margin;
      const footerWidth = (pageWidth - margin * 2) / 3;
      const signatureGroups = [
        { label: "Prepared By", people: signatories.preparedBy ? [signatories.preparedBy] : [] },
        { label: "Reviewed By", people: signatories.reviewedBy ?? [] },
        { label: "Approved By", people: signatories.approvedBy ? [signatories.approvedBy] : [] },
      ];
      signatureGroups.forEach((group, columnIndex) => {
        const footerX = margin + columnIndex * footerWidth;
        content += rect(footerX, footerY, footerWidth, signatureFooterHeight);
        content += text(group.label, footerX + 5, footerY + signatureFooterHeight - 14, 7, true);
        const people = group.people;
        if (people.length === 0) return;
        const availablePeopleHeight = signatureFooterHeight - 26;
        const personHeight = people.length === 1 ? availablePeopleHeight : availablePeopleHeight / people.length;
        people.forEach((person, personIndex) => {
          const personTop = footerY + signatureFooterHeight - 23 - personIndex * personHeight;
          if (person.signatureDataUrl) {
            const imageIndex = signatureImages.findIndex(image => image.dataUrl === person.signatureDataUrl);
            if (imageIndex < 0) throw new Error("Programme signatures must be converted to JPEG before PDF generation.");
            const imageWidth = Math.min(100, footerWidth - 12);
            const imageHeight = 18;
            const imageX = footerX + (footerWidth - imageWidth) / 2;
            const imageY = personTop - 28;
            content += `q ${imageWidth.toFixed(2)} 0 0 ${imageHeight.toFixed(2)} ${imageX.toFixed(2)} ${imageY.toFixed(2)} cm /Sig${imageIndex} Do Q\n`;
          }
          const metadata = [person.name, person.designation, person.role].filter(Boolean);
          let metadataY = personTop - 40;
          metadata.forEach((value, lineIndex) => {
            const lines = wrapText(value, footerWidth - 14, 6).slice(0, 2);
            for (const line of lines) {
              content += centeredText(line, footerX, metadataY, footerWidth, lineIndex === 0 ? 6.5 : 6, lineIndex === 0);
              metadataY -= 9;
            }
          });
        });
      });
    }
    pages.push(content);
  }
  const encoder = new TextEncoder();
  const logoBytes = Uint8Array.from(atob(programmeLogoJpegBase64), character => character.charCodeAt(0));
  const logoStream = ascii85Encode(logoBytes);
  const pageObjectIds = pages.map((_, index) => 6 + index * 2);
  const objects: string[] = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    `<< /Type /Pages /Kids [${pageObjectIds.map(id => `${id} 0 R`).join(" ")}] /Count ${pages.length} >>`,
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>",
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>",
    `<< /Type /XObject /Subtype /Image /Width 180 /Height 59 /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter [/ASCII85Decode /DCTDecode] /Length ${encoder.encode(logoStream).length} >>\nstream\n${logoStream}\nendstream`,
  ];
  const signatureObjectIds = signatureImages.map((_, index) => 6 + pages.length * 2 + index);
  pages.forEach((content, index) => {
    const contentId = 7 + index * 2;
    const signatureResources = signatureObjectIds.map((id, signatureIndex) => `/Sig${signatureIndex} ${id} 0 R`).join(" ");
    objects.push(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${pageWidth} ${pageHeight}] /Resources << /Font << /F1 3 0 R /F2 4 0 R >> /XObject << /Logo 5 0 R ${signatureResources} >> >> /Contents ${contentId} 0 R >>`);
    objects.push(`<< /Length ${encoder.encode(content).length} >>\nstream\n${content}endstream`);
  });
  signatureImages.forEach(image => {
    objects.push(`<< /Type /XObject /Subtype /Image /Width 180 /Height 59 /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter [/ASCII85Decode /DCTDecode] /Length ${encoder.encode(image.stream).length} >>\nstream\n${image.stream}\nendstream`);
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
  return encoder.encode(pdf);
};
const prepareProgrammeSignatories = async (signatories: ProgrammeSignatories): Promise<ProgrammeSignatories> => {
  const convertSignature = async (person: ProgrammeSignatory | null) => {
    if (!person?.signatureDataUrl) return person;
    if (!/^data:image\/(?:png|webp|jpeg);base64,[A-Za-z0-9+/]+=*$/.test(person.signatureDataUrl)) {
      throw new Error(`Unable to decode signature for ${person.name || "programme signatory"}.`);
    }
    try {
      const image = new Image();
      await new Promise<void>((resolve, reject) => {
        image.onload = () => resolve();
        image.onerror = () => reject(new Error("Image decoding failed"));
        image.src = person.signatureDataUrl!;
      });
      if (!image.naturalWidth || !image.naturalHeight) throw new Error("Image has no dimensions");
      const canvas = document.createElement("canvas");
      canvas.width = 180;
      canvas.height = 59;
      const context = canvas.getContext("2d");
      if (!context) throw new Error("Canvas is unavailable");
      context.fillStyle = "#ffffff";
      context.fillRect(0, 0, canvas.width, canvas.height);
      const scale = Math.min(canvas.width / image.naturalWidth, canvas.height / image.naturalHeight);
      const imageWidth = image.naturalWidth * scale;
      const imageHeight = image.naturalHeight * scale;
      context.drawImage(image, (canvas.width - imageWidth) / 2, (canvas.height - imageHeight) / 2, imageWidth, imageHeight);
      const jpeg = await new Promise<Blob>((resolve, reject) => {
        canvas.toBlob(blob => blob ? resolve(blob) : reject(new Error("JPEG conversion failed")), "image/jpeg", 0.92);
      });
      const signatureDataUrl = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => typeof reader.result === "string" ? resolve(reader.result) : reject(new Error("JPEG conversion failed"));
        reader.onerror = () => reject(new Error("JPEG conversion failed"));
        reader.readAsDataURL(jpeg);
      });
      return { ...person, signatureDataUrl };
    } catch {
      throw new Error(`Unable to decode or convert signature for ${person.name || "programme signatory"}.`);
    }
  };
  const [preparedBy, approvedBy, reviewedBy] = await Promise.all([
    convertSignature(signatories.preparedBy),
    convertSignature(signatories.approvedBy),
    Promise.all(signatories.reviewedBy.map(convertSignature)),
  ]);
  return { preparedBy, approvedBy, reviewedBy: reviewedBy as ProgrammeSignatory[] };
};
const programmePdfDownload = async (rows: AuditSchedule[], fileName: string, auditTitle: string, signatories?: ProgrammeSignatories) => {
  const normalizedSignatories = signatories ? await prepareProgrammeSignatories(signatories) : undefined;
  const url = URL.createObjectURL(new Blob([buildProgrammePdf(rows, auditTitle, normalizedSignatories)], { type: "application/pdf" }));
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = fileName;
  anchor.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 0);
};
const workflowTone = (value: string) =>
  value === "Approved" || value === "Closed" || value === "Accepted" || value === "Shared"
    ? "default" : value === "Rejected" || value === "Sent Back" ? "destructive" : "secondary";

function FeasibilityBadge({ decision }: { decision?: AuditSchedule["feasibilityDecision"] }) {
  if (decision === "cancelled") {
    return <Badge variant="destructive">Cancelled</Badge>;
  }
  if (decision === "reschedule") {
    return <Badge className="border-amber-300 bg-amber-100 text-amber-900 hover:bg-amber-100">Reschedule</Badge>;
  }
  return null;
}

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
  const links = [["Dashboard", "/audit"], ["For my Action", "/audit/my-actions"], ["Schedules", "/audit/schedules"], ["Plans", "/audit/plans"], ["Audits", "/audit/audits"], ["CAR register", "/audit/cars"], ["Reports", "/audit/reports"]];
  return <nav className="flex gap-1 overflow-x-auto border-b pb-3">{links.map(([label, href]) => <Button key={href} variant="ghost" size="sm" asChild><Link href={href}>{label}</Link></Button>)}</nav>;
}

function Layout({ children }: { children: React.ReactNode }) {
  return <main className="mx-auto max-w-7xl space-y-6 p-4 md:p-8"><div className="rounded-xl bg-primary p-6 text-primary-foreground"><div className="flex items-center gap-3"><ShieldCheck className="size-8"/><div><p className="font-semibold">QMS Audit Management</p><p className="text-sm opacity-80">ISO 9001 audit lifecycle workspace</p></div></div></div><AuditNav/>{children}</main>;
}

function MyActions() {
  const [page, setPage] = useState(1);
  const query = useListAuditMyActions({ page, limit: PAGE_SIZE }, { query: { queryKey: ["/api/audit/my-actions", { page, limit: PAGE_SIZE }], refetchInterval: 30000 } });
  return <div className="space-y-5">
    <PageHeader title="For my Action" description="Audit work awaiting your review or completion."/>
    <State loading={query.isLoading} error={query.error} empty={!query.data?.items.length} label="No audit items require your action."/>
    {!!query.data?.items.length && <Card className="overflow-x-auto"><Table>
      <TableHeader><TableRow><TableHead>Action item</TableHead><TableHead>Type</TableHead><TableHead>Status</TableHead><TableHead>Due date</TableHead><TableHead className="text-right">Action</TableHead></TableRow></TableHeader>
      <TableBody>{query.data.items.map(item => <TableRow key={`${item.kind}:${item.id}`}>
        <TableCell><Link href={item.href} className="font-semibold text-primary hover:underline">{item.title}</Link></TableCell>
        <TableCell className="capitalize">{({ programme: "Audit schedule", schedule: "Audit", plan: "Audit plan", audit: "Audit execution", car: "Corrective action" } as const)[item.kind]}</TableCell>
        <TableCell><Badge variant={workflowTone(item.status)}>{item.status}</Badge></TableCell>
        <TableCell>{item.dueDate ? date(item.dueDate) : "—"}</TableCell>
        <TableCell className="text-right"><Button size="sm" asChild><Link href={item.href}>{item.action}</Link></Button></TableCell>
      </TableRow>)}</TableBody>
    </Table></Card>}
    {!!query.data?.total && <Pager page={page} total={query.data.total} onPage={setPage}/>}
  </div>;
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
    plannedStartDate: "", plannedEndDate: "", qaqcReference: "",
    auditNumber: "", qaqcScope: "System and Process audits against ISO 9001:2015",
    qaqcClauses: "ISO 9001 — All clauses", remarks: "", l1Name: "", l1ReviewStatus: "Pending",
    l1ReviewComments: "", l1Attachments: [], l2Name: "", l2ReviewStatus: "Pending", l2ReviewComments: "",
    l2Attachments: [], memoDescription: "", memoCirculation: "", ownerId: "", workflowState: "Draft",
    currentApprovalRole: null, approvalRoles: [], canReview: false,
  });
  const create = useCreateAuditSchedule(); const update = useUpdateAuditSchedule();
  const auditTypes = useLov("audit_types");
  const auditCategories = useLov("audit_categories");
  const processOwners = useListAuditProcessProductOwners();
  const processOwnerOptions = [...new Set((processOwners.data ?? []).map(user => user.fullName))]
    .map(name => ({ value: name, label: name }));
  const departments = useLov("departments");
  const projects = useListPlatformProjects({ page: 1, limit: 200 });
  const projectRows = projects.data?.items ?? [];
  const projectOptions = projectRows.map(project => ({
    value: project.id,
    label: project.code ? `${project.code} — ${project.name}` : project.name,
  }));
  const selectedAuditType = form.auditTypes?.[0] ?? "";
  const filteredCategories = categoryOptionsForAuditType(auditCategories.options, selectedAuditType);
  const legacyCategoryUnchanged = Boolean(initial && initial.auditCategory === form.auditCategory &&
    initial.auditTypes?.length === form.auditTypes?.length &&
    initial.auditTypes?.every(type => form.auditTypes?.includes(type)));
  const categoryOptions = legacyCategoryUnchanged
    ? withLegacyOption(filteredCategories, form.auditCategory)
    : filteredCategories;
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
    setForm(current => ({
      ...current, auditTypes: [value], projectIds: [], departmentProject: "",
      auditCategory: categoryOptionsForAuditType(auditCategories.options, value)
        .some(option => option.value === current.auditCategory) ? current.auditCategory : "",
    }));
    setErrors(current => {
      const next = { ...current };
      delete next.auditTypes;
      delete next.auditCategory;
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
    else if (!categoryOptions.some(option => option.value === form.auditCategory)) {
      missing.auditCategory = "Choose an Audit Category linked to the selected Audit Type.";
    }
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
    <div id="schedule-auditCategory"><Label>2. Audit Category *</Label><Select value={form.auditCategory ?? ""} disabled={!selectedAuditType || auditCategories.isLoading || ro("auditCategory")} onValueChange={v => field("auditCategory", v)}><SelectTrigger aria-invalid={!!errors.auditCategory} className={invalid("auditCategory")}><SelectValue placeholder={selectedAuditType ? "Select category" : "Select Audit Type first"}/></SelectTrigger><SelectContent>{categoryOptions.map(x => <SelectItem key={x.value} value={x.value}>{x.label}</SelectItem>)}</SelectContent></Select>{selectedAuditType && !auditCategories.isLoading && !filteredCategories.length && <p className="mt-1 text-xs text-muted-foreground">No Audit Categories are linked to this Audit Type in master data.</p>}{error("auditCategory")}</div>
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
    <div id="schedule-processProductOwner"><Label>6. Process / Product Owner *</Label><Select value={form.processProductOwner ?? ""} disabled={processOwners.isLoading || !!processOwners.error || ro("processProductOwner")} onValueChange={v => field("processProductOwner", v)}><SelectTrigger aria-invalid={!!errors.processProductOwner} className={invalid("processProductOwner")}><SelectValue placeholder="Select owner"/></SelectTrigger><SelectContent>{withLegacyOption(processOwnerOptions, initial?.processProductOwner === form.processProductOwner ? form.processProductOwner : "").map(x => <SelectItem key={x.value} value={x.value}>{x.label}</SelectItem>)}</SelectContent></Select>{error("processProductOwner")}{processOwners.error && <p className="mt-1 text-xs text-destructive">Unable to load eligible owners. <button type="button" className="underline" onClick={() => processOwners.refetch()}>Retry</button></p>}{!processOwners.isLoading && !processOwners.error && !processOwnerOptions.length && <p className="mt-1 text-xs text-muted-foreground">Assign an active Audit user the Product / Process Owner authorization to select an owner.</p>}</div>
     <div className="grid grid-cols-2 gap-3"><div id="schedule-plannedStartDate"><Label>7. From Date *</Label><Input aria-invalid={!!errors.plannedStartDate} className={invalid("plannedStartDate")} type="date" min={parentRange?.fromDate} max={parentRange?.toDate} value={form.plannedStartDate.slice(0,10)} disabled={ro("plannedStartDate")} onChange={e => field("plannedStartDate", e.target.value)}/>{error("plannedStartDate")}</div><div id="schedule-plannedEndDate"><Label>To Date *</Label><Input aria-invalid={!!errors.plannedEndDate} className={invalid("plannedEndDate")} type="date" min={parentRange?.fromDate} max={parentRange?.toDate} value={form.plannedEndDate.slice(0,10)} disabled={ro("plannedEndDate")} onChange={e => field("plannedEndDate", e.target.value)}/>{error("plannedEndDate")}</div></div>
    <div><Label>8. QA/QC Reference *</Label><Input readOnly value={form.qaqcReference ?? ""} placeholder="Assigned when Audit Schedule is submitted"/></div>
    <div><Label>9. Audit Number / Site Visit No. *</Label><Input readOnly value={form.auditNumber ?? ""} placeholder="Assigned when this audit is saved"/></div>
    <div><Label>10. QA/QC Scope *</Label><Input readOnly value={form.qaqcScope ?? ""}/></div>
    <div><Label>11. QA/QC Clauses *</Label><Input readOnly value={form.qaqcClauses ?? ""}/></div>
    <div><Label>12. Remarks{req("remarks") ? " *" : ""}</Label><Textarea value={form.remarks ?? ""} disabled={ro("remarks")} onChange={e => field("remarks", e.target.value)}/></div>
    <DialogFooter><Button variant="outline" onClick={onClose}>Cancel</Button><Button onClick={() => void save()} disabled={create.isPending || update.isPending}>Save schedule</Button></DialogFooter>
  </div>;
}

function ScheduleGantt({ items, onDisplay, onEdit, onNewPlan, planCreationDisabled }: {
  items: AuditSchedule[];
  onDisplay: (item: AuditSchedule) => void;
  onEdit: (item: AuditSchedule) => void;
  onNewPlan: (item: AuditSchedule) => void;
  planCreationDisabled: boolean;
}) {
  if (items.length === 0) return null;

  const year = items[0]?.year ?? new Date().getFullYear();
  const timeline = programmeTimeline(year);
  const { months, totalSlots, weekNumbers } = timeline;
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
              {weekNumbers.map(week => (
                <div key={week} className="flex shrink-0 items-center justify-center border-r" style={{ width: weekWidth }}>W{week}</div>
              ))}
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
                  {item.feasibilityDecision && <div className="mt-1"><FeasibilityBadge decision={item.feasibilityDecision}/></div>}
                  <div className="mt-2 flex flex-wrap gap-1">
                    <Button size="sm" variant="outline" className="h-7 px-2 text-xs" onClick={() => onDisplay(item)}>Display</Button>
                    {item.workflowState === "Draft" && <Button size="sm" variant="outline" className="h-7 px-2 text-xs" onClick={() => onEdit(item)}>Edit</Button>}
                    {item.feasibilityFeedback && <Button size="icon" variant="ghost" className="size-7" aria-label="View feasibility feedback" title="View Remarks / Feedback" onClick={() => onDisplay(item)}><Info className="size-4"/></Button>}
                    {item.workflowState === "Approved" && <Button size="sm" className="h-7 px-2 text-xs" title={planCreationDisabled ? "New plans cannot be created while the audit schedule is submitted" : item.hasPlan ? "An Audit Plan already exists for this Audit Schedule" : item.feasibilityDecision === "cancelled" ? "This audit was cancelled and cannot be planned" : "Create Audit Plan"} disabled={planCreationDisabled || item.hasPlan || item.feasibilityDecision === "cancelled"} onClick={() => onNewPlan(item)}>New Plan</Button>}
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
  const leads = useListAuditTeamLeads();
  const qc = useQueryClient();
  const { toast } = useToast();
  const [title, setTitle] = useState("");
  const [fromDate, setFromDate] = useState("");
  const [toDate, setToDate] = useState("");
  const [teamLeadIds, setTeamLeadIds] = useState<string[]>([]);
  const [leadError, setLeadError] = useState("");
  const save = () => {
    if (!title.trim() || !fromDate || !toDate) {
      toast({ title: "Complete the programme details", description: "Audit Title, From Date and To Date are required.", variant: "destructive" });
      return;
    }
    if (toDate < fromDate) {
      toast({ title: "Invalid date range", description: "To Date must be on or after From Date.", variant: "destructive" });
      return;
    }
    if (!teamLeadIds.length) {
      setLeadError("Select at least one Audit Team Lead.");
      return;
    }
    if (leads.isError || leads.isLoading || teamLeadIds.some(id => !leads.data?.some(user => user.id === id))) {
      setLeadError("Reload the eligible Audit Team Leads before saving.");
      return;
    }
    create.mutate({ data: { title: title.trim(), fromDate, toDate, teamLeadIds } }, {
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
    <div>
      <Label>Audit Team Lead *</Label>
      <DropdownMenu><DropdownMenuTrigger asChild><Button type="button" variant="outline" aria-invalid={!!leadError} className="mt-2 w-full justify-between font-normal" disabled={leads.isLoading || leads.isError}>
        <span className="truncate">{teamLeadIds.length ? teamLeadIds.map(id => leads.data?.find(user => user.id === id)?.fullName).filter(Boolean).join(", ") : leads.isLoading ? "Loading team leads…" : "Select Audit Team Lead(s)"}</span><ChevronDown className="ml-2 size-4 shrink-0"/>
      </Button></DropdownMenuTrigger><DropdownMenuContent className="w-[var(--radix-dropdown-menu-trigger-width)] max-h-64 overflow-y-auto">
        {(leads.data ?? []).map(user => <DropdownMenuCheckboxItem key={user.id} checked={teamLeadIds.includes(user.id)} onSelect={event => event.preventDefault()} onCheckedChange={checked => {
          setTeamLeadIds(current => checked === true ? [...new Set([...current, user.id])] : current.filter(id => id !== user.id));
          setLeadError("");
        }}>{user.fullName}{user.designation ? ` — ${user.designation}` : ""}</DropdownMenuCheckboxItem>)}
      </DropdownMenuContent></DropdownMenu>
      {leadError && <p className="mt-1 text-sm text-destructive" role="alert">{leadError}</p>}
      {leads.isError && <p className="mt-1 text-sm text-destructive">Unable to load Audit Team Leads. Close and reopen this form to retry.</p>}
      {!leads.isLoading && !leads.isError && !leads.data?.length && <p className="mt-1 text-sm text-muted-foreground">No eligible users. Assign an active Audit Team Lead role to an active user with Audit application access first.</p>}
    </div>
    <DialogFooter><Button variant="outline" onClick={onClose}>Cancel</Button><Button onClick={save} disabled={create.isPending || leads.isLoading || leads.isError || !leads.data?.length}>Save audit schedule</Button></DialogFooter>
  </div>;
}

function ProgrammeSubmitDialog({ item, onClose, onSubmitted }: {
  item: { id: string; title: string };
  onClose: () => void;
  onSubmitted: (updated: AuditProgramme) => void;
}) {
  const [subject, setSubject] = useState(item.title);
  const [mailBody, setMailBody] = useState("");
  const submit = useSubmitAuditProgramme();
  const { toast } = useToast();
  const submitProgramme = () => {
    if (!subject.trim() || !mailBody.trim()) return;
    submit.mutate({ id: item.id, data: { subject: subject.trim(), mailBody: mailBody.trim() } }, {
      onSuccess: updated => { onSubmitted(updated); onClose(); },
      onError: e => toast({ title: "Unable to submit schedule", description: errorText(e), variant: "destructive" }),
    });
  };
  return <Dialog open onOpenChange={isOpen => !isOpen && onClose()}>
    <DialogContent className="max-w-2xl">
      <DialogHeader>
        <DialogTitle>Submit audit schedule</DialogTitle>
        <DialogDescription>Enter the email content to retain with this approval submission. Email delivery will be enabled separately.</DialogDescription>
      </DialogHeader>
      <div className="grid gap-4 py-2">
        <div className="grid gap-2"><Label htmlFor="schedule-submission-subject">Subject</Label><Input id="schedule-submission-subject" value={subject} onChange={event => setSubject(event.target.value)} maxLength={200}/></div>
        <div className="grid gap-2"><Label htmlFor="schedule-submission-body">Mail Body</Label><Textarea id="schedule-submission-body" value={mailBody} onChange={event => setMailBody(event.target.value)} rows={8} maxLength={10000}/></div>
      </div>
      <DialogFooter><Button variant="outline" onClick={onClose}>Cancel</Button><Button onClick={submitProgramme} disabled={submit.isPending || !subject.trim() || !mailBody.trim()}>Submit for approval</Button></DialogFooter>
    </DialogContent>
  </Dialog>;
}

function ProgrammeSendBackDialog({ item, onClose, onSentBack }: {
  item: { id: string; title: string };
  onClose: () => void;
  onSentBack: (updated: AuditProgramme) => void;
}) {
  const [comments, setComments] = useState("");
  const review = useReviewAuditProgramme();
  const { toast } = useToast();
  const sendBack = () => {
    if (!comments.trim()) return;
    review.mutate({ id: item.id, data: { decision: "send_back", comments: comments.trim() } }, {
      onSuccess: updated => { onSentBack(updated); onClose(); },
      onError: e => toast({ title: "Unable to send back schedule", description: errorText(e), variant: "destructive" }),
    });
  };
  return <Dialog open onOpenChange={isOpen => !isOpen && onClose()}>
    <DialogContent className="max-w-2xl">
      <DialogHeader>
        <DialogTitle>Send back audit schedule</DialogTitle>
        <DialogDescription>Provide the required remarks for sending {item.title} back.</DialogDescription>
      </DialogHeader>
      <div className="grid gap-2 py-2">
        <Label htmlFor="schedule-send-back-comments">Send-back remarks *</Label>
        <Textarea id="schedule-send-back-comments" value={comments} onChange={event => setComments(event.target.value)} rows={6} autoFocus/>
      </div>
      <DialogFooter><Button variant="outline" onClick={onClose}>Cancel</Button><Button onClick={sendBack} disabled={review.isPending || !comments.trim()}>Send back</Button></DialogFooter>
    </DialogContent>
  </Dialog>;
}

function ProgrammeDetailsDialog({ item, onClose }: { item: AuditProgramme; onClose: () => void }) {
  return <Dialog open onOpenChange={isOpen => !isOpen && onClose()}>
    <DialogContent className="max-w-lg">
      <DialogHeader>
        <DialogTitle>Audit Schedule details</DialogTitle>
        <DialogDescription>Schedule dates and current Audit Team Lead selection.</DialogDescription>
      </DialogHeader>
      <dl className="grid gap-4 py-2 sm:grid-cols-2">
        <div className="sm:col-span-2"><dt className="text-sm text-muted-foreground">Audit Title</dt><dd className="font-medium">{item.title}</dd></div>
        <div><dt className="text-sm text-muted-foreground">From Date</dt><dd className="font-medium">{date(item.fromDate)}</dd></div>
        <div><dt className="text-sm text-muted-foreground">To Date</dt><dd className="font-medium">{date(item.toDate)}</dd></div>
        <div className="sm:col-span-2">
          <dt className="text-sm text-muted-foreground">Audit Team Leads</dt>
          <dd className="mt-1">{item.teamLeadNames.length
            ? <ul className="list-inside list-disc space-y-1">{item.teamLeadNames.map((name, index) => <li key={`${index}-${name}`}>{name}</li>)}</ul>
            : <span className="text-muted-foreground">Not recorded for this older schedule</span>}</dd>
        </div>
      </dl>
      <DialogFooter><Button onClick={onClose}>Close</Button></DialogFooter>
    </DialogContent>
  </Dialog>;
}

function ProgrammeTeamLeadsDialog({ item, onClose, onSaved }: {
  item: AuditProgramme; onClose: () => void; onSaved: (updated: AuditProgramme) => void;
}) {
  const [selected, setSelected] = useState<string[]>(item.teamLeadIds);
  const leads = useListAuditTeamLeads();
  const update = useUpdateAuditProgrammeTeamLeads();
  const { toast } = useToast();
  const available = leads.data ?? [];
  const selectedUsers = selected.map(id => ({
    id, name: available.find(user => user.id === id)?.fullName ?? item.teamLeadNames[item.teamLeadIds.indexOf(id)] ?? `User unavailable (${id.slice(0, 8)})`,
  }));
  const save = () => {
    if (!selected.length) return;
    if (selected.some(id => !item.teamLeadIds.includes(id) && !available.some(user => user.id === id))) return;
    update.mutate({ id: item.id, data: { teamLeadIds: selected } }, {
      onSuccess: updated => { onSaved(updated); onClose(); },
      onError: error => toast({ title: "Unable to update Audit Team Leads", description: errorText(error), variant: "destructive" }),
    });
  };
  return <Dialog open onOpenChange={open => !open && !update.isPending && onClose()}>
    <DialogContent className="max-w-lg">
      <DialogHeader><DialogTitle>Manage Audit Team Leads</DialogTitle><DialogDescription>Change the selected leads for this approved Audit Schedule. Leads assigned to active Audit Plans cannot be removed.</DialogDescription></DialogHeader>
      <div className="space-y-4">
        <div><Label>Selected Audit Team Leads</Label>
          <ul className="mt-2 space-y-2">{selectedUsers.map(user => <li key={user.id} className="flex items-center justify-between gap-3 rounded-md border px-3 py-2 text-sm"><span>{user.name}</span><Button size="sm" variant="ghost" aria-label={`Remove ${user.name}`} disabled={selected.length <= 1 || update.isPending} onClick={() => setSelected(current => current.filter(id => id !== user.id))}><Trash2 className="size-4"/></Button></li>)}</ul>
        </div>
        <div><Label>Add Audit Team Lead</Label>
          {leads.isLoading ? <p className="mt-2 text-sm text-muted-foreground">Loading eligible leads…</p> : leads.isError ? <p className="mt-2 text-sm text-destructive">Unable to load eligible leads. Close and reopen to retry.</p> : <div className="mt-2 max-h-48 space-y-1 overflow-y-auto">{available.filter(user => !selected.includes(user.id)).map(user => <Button key={user.id} type="button" variant="outline" className="w-full justify-start" disabled={update.isPending} onClick={() => setSelected(current => [...current, user.id])}><Plus className="mr-2 size-4"/>{user.fullName}{user.designation ? ` — ${user.designation}` : ""}</Button>)}{available.every(user => selected.includes(user.id)) && <p className="text-sm text-muted-foreground">All eligible leads are selected.</p>}</div>}
        </div>
      </div>
      <DialogFooter><Button variant="outline" disabled={update.isPending} onClick={onClose}>Cancel</Button><Button disabled={update.isPending || leads.isLoading || leads.isError || !selected.length || selected.join(",") === item.teamLeadIds.join(",")} onClick={save}>{update.isPending ? "Saving…" : "Save Team Leads"}</Button></DialogFooter>
    </DialogContent>
  </Dialog>;
}

function Programmes() {
  const [page, setPage] = useState(1);
  const [open, setOpen] = useState(false);
  const [submitting, setSubmitting] = useState<{ id: string; title: string }>();
  const [sendingBack, setSendingBack] = useState<{ id: string; title: string }>();
  const [viewingDetails, setViewingDetails] = useState<AuditProgramme>();
  const [managingLeads, setManagingLeads] = useState<AuditProgramme>();
  const query = useListAuditProgrammes({ page, limit: PAGE_SIZE });
  const qc = useQueryClient();
  const { toast } = useToast();
  const review = useReviewAuditProgramme();
  const remove = useDeleteAuditProgramme();
  const done = (message: string, updated?: AuditProgramme) => {
    if (updated) {
      qc.setQueriesData<AuditProgrammePage>({ queryKey: getListAuditProgrammesQueryKey() }, current =>
        current ? { ...current, items: current.items.map(item => item.id === updated.id ? updated : item) } : current);
    }
    void qc.invalidateQueries({ queryKey: getListAuditProgrammesQueryKey() });
    void qc.invalidateQueries({ queryKey: ["/api/audit/schedules"] });
    void qc.invalidateQueries({ queryKey: ["/api/audit/programmes"] });
    void qc.invalidateQueries({ queryKey: ["/api/audit/my-actions"] });
    toast({ title: message });
  };
  return <div className="space-y-5">
    <PageHeader title="Audit schedules" description="Create and manage annual audit programmes" action={<Button onClick={() => setOpen(true)}><Plus className="mr-2 size-4"/>New Schedule</Button>} />
    <Dialog open={open} onOpenChange={setOpen}><DialogContent className="max-w-lg"><DialogHeader><DialogTitle>New Schedule</DialogTitle></DialogHeader><ProgrammeForm onClose={() => setOpen(false)} /></DialogContent></Dialog>
    {submitting && <ProgrammeSubmitDialog key={submitting.id} item={submitting} onClose={() => setSubmitting(undefined)} onSubmitted={updated => done("Audit schedule submitted", updated)}/>}
    {sendingBack && <ProgrammeSendBackDialog key={sendingBack.id} item={sendingBack} onClose={() => setSendingBack(undefined)} onSentBack={updated => done("Audit schedule sent back", updated)}/>}
    {viewingDetails && <ProgrammeDetailsDialog item={query.data?.items.find(item => item.id === viewingDetails.id) ?? viewingDetails} onClose={() => setViewingDetails(undefined)}/>}
    {managingLeads && <ProgrammeTeamLeadsDialog item={query.data?.items.find(item => item.id === managingLeads.id) ?? managingLeads} onClose={() => setManagingLeads(undefined)} onSaved={updated => done("Audit Team Leads updated", updated)}/>}
    <State loading={query.isLoading} error={query.error} empty={!(query.data?.items?.length)} label="No audit schedules found." />
    {!!query.data?.items?.length && <Card><Table><TableHeader><TableRow><TableHead>Audit schedule</TableHead><TableHead>Dates</TableHead><TableHead>Audits</TableHead><TableHead>Status</TableHead><TableHead>Pending approver</TableHead><TableHead className="text-right">Actions</TableHead></TableRow></TableHeader><TableBody>
      {query.data.items.map(item => <TableRow key={item.id}><TableCell><Button variant="link" className="h-auto p-0 text-left font-semibold" asChild><Link href={`/audit/schedules/${item.id}`}>{item.title}</Link></Button><div className="text-xs text-muted-foreground">Annual programme</div></TableCell><TableCell>{date(item.fromDate)} – {date(item.toDate)}</TableCell><TableCell>{item.childCount}</TableCell><TableCell><Badge variant={workflowTone(item.workflowState)}>{item.workflowState}</Badge></TableCell><TableCell>{item.workflowState === "Submitted" ? <><div className="font-medium">{item.currentApproverNames.length ? item.currentApproverNames.join(", ") : "No active assignee"}</div><div className="text-xs text-muted-foreground">{item.currentApprovalRole ?? "Approval role unavailable"}</div></> : "—"}</TableCell><TableCell><div className="flex justify-end gap-1">
        {item.id !== "legacy" && <Button size="sm" variant="outline" onClick={() => setViewingDetails(item)}><Info className="mr-1 size-4"/>Details</Button>}
        {item.canManageTeamLeads && <Button size="sm" variant="outline" onClick={() => setManagingLeads(item)}>Manage Team Leads</Button>}
        {item.id !== "legacy" && item.canSubmit && <Button size="sm" disabled={item.childCount === 0 || !!submitting} onClick={() => setSubmitting(item)}>{item.workflowState === "Sent Back" ? "Resubmit" : "Submit"}</Button>}
        {item.id !== "legacy" && item.workflowState === "Submitted" && item.canReview && <><Button size="sm" onClick={() => review.mutate({ id: item.id, data: { decision: "approve" } }, { onSuccess: updated => done("Audit schedule approved", updated), onError: e => toast({ title: "Unable to approve schedule", description: errorText(e), variant: "destructive" }) })}>Approve</Button><Button size="sm" variant="outline" onClick={() => setSendingBack(item)}>Send back</Button></>}
        {item.id !== "legacy" && <Button size="icon" variant="ghost" aria-label={`Delete ${item.title}`} title={item.workflowState === "Approved" ? "Approved audit schedules cannot be deleted" : item.childCount > 0 ? "Audit schedules with child audits cannot be deleted" : "Delete audit schedule"} disabled={item.workflowState === "Approved" || item.childCount > 0 || remove.isPending} onClick={() => window.confirm("Delete this audit schedule?") && remove.mutate({ id: item.id }, { onSuccess: () => done("Audit schedule deleted"), onError: e => toast({ title: "Unable to delete audit schedule", description: errorText(e), variant: "destructive" }) })}><Trash2 className="size-4"/></Button>}
      </div></TableCell></TableRow>)}
    </TableBody></Table><CardContent><Pager page={page} total={query.data?.total ?? 0} onPage={setPage} /></CardContent></Card>}
  </div>;
}

function Schedules() {
  const { parentId = "" } = useParams<{ parentId: string }>();
  const focusId = new URLSearchParams(window.location.search).get("focusSchedule") ?? "";
  const [page, setPage] = useState(1); const [search, setSearch] = useState(""); const [editing, setEditing] = useState<AuditSchedule | undefined>(); const [open, setOpen] = useState(false); const [displaying, setDisplaying] = useState<AuditSchedule | undefined>();
  const [submitting, setSubmitting] = useState<{ id: string; title: string }>();
  const [sendingProgrammeBack, setSendingProgrammeBack] = useState<{ id: string; title: string }>();
  const [viewMode, setViewMode] = useState<"list" | "gantt">("list");
  const [showProgrammeDetails, setShowProgrammeDetails] = useState(false);
  const [showLeadManager, setShowLeadManager] = useState(false);
  const [planning, setPlanning] = useState<AuditSchedule | undefined>();
  const query = useListAuditSchedules({ page, limit: PAGE_SIZE, parentId }); const planSchedules = useListAuditPlans({ page: 1, limit: 100 }); const qc = useQueryClient(); const { toast } = useToast();
  const focused = useGetAuditSchedule(focusId, { query: { enabled: !!focusId, queryKey: ["/api/audit/schedules", focusId] } });
  const submitFocused = useSubmitAuditSchedule();
  const programme = useGetAuditProgramme(parentId, { query: { enabled: parentId !== "legacy" && !!parentId, queryKey: getGetAuditProgrammeQueryKey(parentId) } });
  const allChildren = useListAuditSchedules({ page: 1, limit: 200, parentId });
  const projects = useListPlatformProjects({ page: 1, limit: 200 });
  const departments = useLov("departments");
  const create = useCreateAuditSchedule();
  const fileInput = useRef<HTMLInputElement>(null);
  const [loadingFile, setLoadingFile] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const remove = useDeleteAuditSchedule(); const review = useReviewAuditSchedule();
  const reviewProgramme = useReviewAuditProgramme();
  const occupiedScheduleIds = new Set((planSchedules.data?.items ?? []).map(plan => plan.scheduleId));
  const items = (query.data?.items ?? [])
    .map(schedule => occupiedScheduleIds.has(schedule.id) ? { ...schedule, hasPlan: true } : schedule)
    .filter(x => x.title.toLowerCase().includes(search.toLowerCase()));
  const done = (message: string) => { qc.invalidateQueries({ queryKey: ["/api/audit/schedules"] }); qc.invalidateQueries({ queryKey: ["/api/audit/programmes"] }); qc.invalidateQueries({ queryKey: ["/api/audit/my-actions"] }); toast({ title: message }); };
  const parentSubmitted = programme.data?.workflowState === "Submitted";
  const programmeSubmitted = (updated: AuditProgramme) => {
    qc.setQueryData(getGetAuditProgrammeQueryKey(parentId), updated);
    done("Audit schedule submitted");
  };
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
      if (viewMode === "gantt") {
        const signatories = parentId !== "legacy" ? await getAuditProgrammeSignatories(parentId) as ProgrammeSignatories : undefined;
        await programmePdfDownload(children, `audit-programme-${parentId}.pdf`, programme.data?.title ?? "", signatories);
      }
      else {
        const [auditTypes, auditCategories, processOwners, departmentLov, firstProjects] = await Promise.all([
          getMasterDataLov("audit_types"), getMasterDataLov("audit_categories"),
          listAuditProcessProductOwners(), getMasterDataLov("departments"),
          listPlatformProjects({ page: 1, limit: 200 }),
        ]);
        const projectRows = [...firstProjects.items];
        for (let nextPage = 2; projectRows.length < firstProjects.total; nextPage += 1) {
          const next = await listPlatformProjects({ page: nextPage, limit: 200 });
          projectRows.push(...next.items);
          if (!next.items.length) break;
        }
        await downloadScheduleWorkbook(children, `audit-schedule-${parentId}.xlsx`, {
          auditTypes: auditTypes.values, auditCategories: auditCategories.values,
          processOwners: [...new Set(processOwners.map(user => user.fullName))].map(name => ({ value: name, label: name })),
          departments: departmentLov.values,
          projects: projectRows,
        }, range);
      }
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
      const auditCategories = await getMasterDataLov("audit_categories");
      const eligibleOwners = new Set((await listAuditProcessProductOwners()).map(user => user.fullName));
      const firstProjects = await listPlatformProjects({ page: 1, limit: 200 });
      const projectRows = [...firstProjects.items];
      for (let nextPage = 2; projectRows.length < firstProjects.total; nextPage += 1) {
        const next = await listPlatformProjects({ page: nextPage, limit: 200 });
        projectRows.push(...next.items);
        if (!next.items.length) break;
      }
      for (let index = 0; index < rows.length; index += 1) {
        const source = rows[index]; const mapped: Record<string, unknown> = {};
        Object.entries(source).forEach(([key, value]) => { const target = scheduleFieldForHeader(key); if (target) mapped[target] = value; });
        const departmentProjectText = String(mapped.departmentProject ?? "").trim();
        const importedAuditTypes = String(mapped.auditTypes).split(",").map(value => value.trim()).filter(Boolean);
        const isImportedProcessAudit = importedAuditTypes.includes(PROCESS_AUDIT_TYPE);
        const project = isImportedProcessAudit ? undefined : resolveScheduleProject(projectRows, departmentProjectText);
        const department = isImportedProcessAudit
          ? departments.options.find(item => item.value === departmentProjectText || item.label === departmentProjectText)
          : undefined;
        const start = scheduleDate(mapped.plannedStartDate); const end = scheduleDate(mapped.plannedEndDate);
        const required = ["auditTypes", "auditCategory", "departmentProject", "title", "processProductOwner", "plannedStartDate", "plannedEndDate"];
        const missing = required.filter(key => !String(mapped[key] ?? "").trim());
        if (missing.length) { failures.push(`row ${index + 2}: missing ${missing.join(", ")}`); continue; }
        const categoryError = scheduleCategoryLinkError(auditCategories.values, importedAuditTypes, String(mapped.auditCategory).trim());
        if (categoryError) { failures.push(`row ${index + 2}: ${categoryError}`); continue; }
        if (!eligibleOwners.has(String(mapped.processProductOwner).trim())) { failures.push(`row ${index + 2}: Process / Product Owner must be an active Audit user with Product / Process Owner authorization`); continue; }
        if (!start || !end) { failures.push(`row ${index + 2}: From Date and To Date must be valid calendar dates in YYYY-MM-DD format`); continue; }
        if (isImportedProcessAudit && !department) { failures.push(`row ${index + 2}: Department / Project must be an active department value or exact name`); continue; }
        if (!isImportedProcessAudit && !project) { failures.push(`row ${index + 2}: Department / Project must be an active project choice, code, or exact name`); continue; }
        if (end < start) { failures.push(`row ${index + 2}: To Date must be on or after From Date`); continue; }
        if (range && (start < range.fromDate || end > range.toDate)) { failures.push(`row ${index + 2}: dates must be within ${range.fromDate} and ${range.toDate}`); continue; }
        const rowParentId = parentId === "legacy" ? null : parentId;
        const dataWithoutId = {
          parentId: rowParentId, year: Number(start.slice(0, 4)),
          title: String(mapped.title), projectIds: project ? [project.id] : [], auditTypes: importedAuditTypes,
          auditCategory: String(mapped.auditCategory), departmentProject: department?.label ?? project?.name ?? "", location: String(mapped.location ?? ""),
          processProductOwner: String(mapped.processProductOwner), plannedStartDate: start, plannedEndDate: end,
          qaqcReference: "", auditNumber: "",
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
  return <div className="space-y-5"><PageHeader title="Audits in schedule" description="Build, submit and approve audits in this programme" action={<div className="flex flex-wrap gap-2">{parentId !== "legacy" && <Button variant="outline" onClick={() => setShowProgrammeDetails(true)} disabled={!programme.data}><Info className="mr-2 size-4"/>Schedule details</Button>}{programme.data?.canManageTeamLeads && <Button variant="outline" onClick={() => setShowLeadManager(true)}>Manage Team Leads</Button>}<Button variant="outline" onClick={() => void download()} disabled={allChildren.isLoading || downloading || programmePending}><Download className="mr-2 size-4"/>{downloading ? "Downloading…" : "Download"}</Button><Button variant="outline" onClick={() => fileInput.current?.click()} disabled={loadingFile || projects.isLoading || programmePending || parentSubmitted}><Upload className="mr-2 size-4"/>{loadingFile ? "Loading…" : "Load"}</Button><input ref={fileInput} type="file" accept=".xlsx,.xls,.csv" className="hidden" onChange={event => { const file = event.target.files?.[0]; if (file) void loadFile(file); }}/>{parentId !== "legacy" && programme.data?.canSubmit && <Button variant="outline" disabled={programmePending || !programme.data.childCount || !!submitting} onClick={() => setSubmitting({ id: parentId, title: programme.data.title })}>{programme.data.workflowState === "Sent Back" ? "Resubmit" : "Submit"}</Button>}{programme.data?.workflowState === "Submitted" && programme.data.canReview && <><Button disabled={reviewProgramme.isPending} onClick={() => reviewProgramme.mutate({ id: parentId, data: { decision: "approve" } }, { onSuccess: updated => { qc.setQueryData(getGetAuditProgrammeQueryKey(parentId), updated); done("Audit schedule approved"); }, onError: e => toast({ title: "Unable to approve schedule", description: errorText(e), variant: "destructive" }) })}>Approve schedule</Button><Button variant="outline" onClick={() => setSendingProgrammeBack({ id: parentId, title: programme.data!.title })}>Send back</Button></>}<Button disabled={programmePending || parentSubmitted} title={parentSubmitted ? "New audits cannot be created while the audit schedule is submitted" : undefined} onClick={() => { setEditing(undefined); setOpen(true); }}><Plus className="mr-2 size-4"/>New Audit</Button></div>}/>
    {showProgrammeDetails && programme.data && <ProgrammeDetailsDialog item={programme.data} onClose={() => setShowProgrammeDetails(false)}/>}
    {showLeadManager && programme.data && <ProgrammeTeamLeadsDialog item={programme.data} onClose={() => setShowLeadManager(false)} onSaved={updated => { qc.setQueryData(getGetAuditProgrammeQueryKey(parentId), updated); done("Audit Team Leads updated"); }}/>}
    {focusId && <Card><CardContent className="flex flex-wrap items-center justify-between gap-4 pt-6">
      {focused.isLoading ? <p>Loading action item…</p> : focused.error ? <p className="text-destructive">{errorText(focused.error)}</p> : focused.data && focused.data.parentId === (parentId === "legacy" ? null : parentId) ? <>
        <div><p className="text-xs font-semibold uppercase text-muted-foreground">Your action item</p><p className="font-semibold">{focused.data.title}</p><Badge variant={workflowTone(focused.data.workflowState)}>{focused.data.workflowState}</Badge></div>
        <div className="flex flex-wrap gap-2"><Button variant="outline" onClick={() => setDisplaying(focused.data)}>Display</Button>
          {["Draft", "Sent Back"].includes(focused.data.workflowState) && focused.data.ownerId && <>
            <Button variant="outline" onClick={() => { setEditing(focused.data); setOpen(true); }}>Edit</Button>
            <Button disabled={submitFocused.isPending} onClick={() => submitFocused.mutate({ id: focused.data.id }, { onSuccess: () => done("Schedule submitted"), onError: e => toast({ title: "Unable to submit schedule", description: errorText(e), variant: "destructive" }) })}>Submit</Button>
          </>}
          {focused.data.workflowState === "Submitted" && focused.data.canReview && <>
            <Button disabled={review.isPending} onClick={() => review.mutate({ id: focused.data.id, data: { decision: "approve" } }, { onSuccess: () => done("Schedule approved"), onError: e => toast({ title: "Unable to approve schedule", description: errorText(e), variant: "destructive" }) })}>Approve</Button>
            <Button variant="outline" onClick={() => sendBack(focused.data.id)}>Send back</Button>
          </>}
        </div>
      </> : <p className="text-muted-foreground">This action item is no longer available in this schedule.</p>}
    </CardContent></Card>}
    {submitting && <ProgrammeSubmitDialog key={submitting.id} item={submitting} onClose={() => setSubmitting(undefined)} onSubmitted={programmeSubmitted}/>}
    {sendingProgrammeBack && <ProgrammeSendBackDialog key={sendingProgrammeBack.id} item={sendingProgrammeBack} onClose={() => setSendingProgrammeBack(undefined)} onSentBack={updated => { qc.setQueryData(getGetAuditProgrammeQueryKey(parentId), updated); done("Audit schedule sent back"); }}/>}
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
    {items.length > 0 && viewMode === "list" && <Card><Table><TableHeader><TableRow><TableHead>Schedule</TableHead><TableHead>Type</TableHead><TableHead>Dates</TableHead><TableHead>Status</TableHead><TableHead className="text-right">Actions</TableHead></TableRow></TableHeader><TableBody>{items.map(item => <TableRow key={item.id}><TableCell><Button variant="link" className="h-auto p-0 text-left font-semibold" onClick={() => setDisplaying(item)}>{item.title}</Button><div className="text-xs text-muted-foreground">{item.currentApprovalRole ? `Pending ${item.currentApprovalRole}` : item.year}</div></TableCell><TableCell>{item.auditTypes?.join(", ") || "—"}</TableCell><TableCell>{date(item.plannedStartDate)} – {date(item.plannedEndDate)}</TableCell><TableCell><div className="flex flex-wrap gap-1"><Badge variant={workflowTone(item.workflowState)}>{item.workflowState}</Badge><FeasibilityBadge decision={item.feasibilityDecision}/></div></TableCell><TableCell><div className="flex justify-end gap-1">
      <Button size="sm" variant="outline" onClick={() => setDisplaying(item)}>Display</Button>
      {item.workflowState === "Draft" && <Button size="sm" variant="outline" onClick={() => { setEditing(item); setOpen(true); }}>Edit</Button>}
      {item.feasibilityFeedback && <Button size="icon" variant="ghost" aria-label={`View feasibility feedback for ${item.title}`} title="View Remarks / Feedback" onClick={() => setDisplaying(item)}><Info className="size-4"/></Button>}
      {item.workflowState === "Approved" && <Button size="sm" title={parentSubmitted ? "New plans cannot be created while the audit schedule is submitted" : item.hasPlan ? "An Audit Plan already exists for this Audit Schedule" : item.feasibilityDecision === "cancelled" ? "This audit was cancelled and cannot be planned" : "Create Audit Plan"} disabled={parentSubmitted || item.hasPlan || item.feasibilityDecision === "cancelled"} onClick={() => setPlanning(item)}><Plus className="mr-2 size-4"/>New Plan</Button>}
      {item.workflowState === "Submitted" && item.canReview && <><Button size="sm" onClick={() => review.mutate({ id: item.id, data: { decision: "approve" } }, { onSuccess: () => done("Schedule approved") })}>Approve</Button><Button size="sm" variant="outline" onClick={() => sendBack(item.id)}>Send back</Button></>}
      <Button size="icon" variant="ghost" aria-label={`Delete ${item.title}`} title={item.workflowState === "Approved" ? "Approved child audits cannot be deleted" : "Delete child audit"} disabled={item.workflowState === "Approved" || remove.isPending} onClick={() => window.confirm("Delete this child audit?") && remove.mutate({ id: item.id }, { onSuccess: () => done("Child audit deleted"), onError: e => toast({ title: "Unable to delete child audit", description: errorText(e), variant: "destructive" }) })}><Trash2 className="size-4"/></Button>
    </div></TableCell></TableRow>)}</TableBody></Table><CardContent><Pager page={page} total={query.data?.total ?? 0} onPage={setPage}/></CardContent></Card>}
    {items.length > 0 && viewMode === "gantt" && <div className="space-y-4"><ScheduleGantt items={items} onDisplay={setDisplaying} onEdit={item => { setEditing(item); setOpen(true); }} onNewPlan={setPlanning} planCreationDisabled={parentSubmitted}/><Card className="bg-transparent border-none shadow-none"><CardContent className="p-0"><Pager page={page} total={query.data?.total ?? 0} onPage={setPage}/></CardContent></Card></div>}
  </div>;
}

function ScheduleDisplay({ schedule, onClose }: { schedule: AuditSchedule; onClose: () => void }) {
  const Field = ({ label, value }: { label: string; value?: string | null }) => <div><p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{label}</p><p className="mt-1 whitespace-pre-wrap text-sm">{value?.trim() || "—"}</p></div>;
  return <><DialogHeader><DialogTitle>Audit Schedule</DialogTitle><p className="text-sm text-muted-foreground">Read-only audit details.</p></DialogHeader>
    <div className="space-y-6 py-2"><div className="flex flex-wrap items-start justify-between gap-3"><div><h2 className="text-xl font-semibold">{schedule.title}</h2><p className="mt-1 text-sm text-muted-foreground">Schedule year {schedule.year}</p></div><Badge variant={workflowTone(schedule.workflowState)}>{schedule.workflowState}</Badge></div>
      {schedule.feasibilityFeedback && <div className="rounded-lg border border-amber-200 bg-amber-50 p-4"><h3 className="font-medium text-amber-950">Audit feasibility feedback</h3><div className="mt-3 grid gap-3 sm:grid-cols-2"><Field label="Decision" value={schedule.feasibilityDecision === "cancelled" ? "Audit cancelled" : "Audit to be rescheduled"}/><Field label="Recorded at" value={schedule.feasibilityRecordedAt ? new Date(schedule.feasibilityRecordedAt).toLocaleString() : null}/><div className="sm:col-span-2"><Field label="Remarks / Feedback" value={schedule.feasibilityFeedback}/></div></div></div>}
      <div className="grid gap-x-8 gap-y-5 sm:grid-cols-2"><Field label="Audit type" value={schedule.auditTypes?.join(", ")}/><Field label="Audit category" value={schedule.auditCategory}/><Field label="Department / project" value={schedule.departmentProject}/><Field label="Process / product owner" value={schedule.processProductOwner}/><Field label="Planned dates" value={`${date(schedule.plannedStartDate)} – ${date(schedule.plannedEndDate)}`}/><Field label="Location" value={schedule.location}/><Field label="QA/QC reference" value={schedule.qaqcReference}/><Field label="Audit number / site visit no." value={schedule.auditNumber}/><Field label="QA/QC scope" value={schedule.qaqcScope}/><Field label="QA/QC clauses" value={schedule.qaqcClauses}/><Field label="Remarks" value={schedule.remarks}/><Field label="Memo circulation" value={schedule.memoCirculation}/></div>
      <Field label="Memo description" value={schedule.memoDescription}/>
    </div>
    <DialogFooter><Button onClick={onClose}>Close</Button></DialogFooter></>;
}

function PlanForm({ schedules, onClose, initial, presetSchedule, readOnly = false }: { schedules: AuditSchedule[]; onClose: () => void; initial?: AuditPlan; presetSchedule?: AuditSchedule; readOnly?: boolean }) {
  const [form, setForm] = useState<AuditPlan>(initial ?? {
    id: crypto.randomUUID(), scheduleId: presetSchedule?.id ?? "", auditFeasible: true, auditTitle: presetSchedule?.title ?? "", leadAuditorId: "",
    teamMemberIds: [], auditeeId: "", auditeeRoleIds: [], qaqcScope: "", auditTypes: [],
    auditLanguage: "Verbal: English\nWriting: English", qaqcReference: presetSchedule?.qaqcReference ?? "", description: "",
    startDateTime: "", endDateTime: "", openingMeetingDateTime: "", closingMeetingDateTime: "",
    activitySection: "General Requirement", activityRemarks: "", activityAuditeeId: "",
    activities: [{ id: crypto.randomUUID(), section: "", remarks: "", auditeeId: "" }],
    activityDateTime: "", auditPlanCirculation: "", status: "Draft",
    ...(presetSchedule ? { qaqcScope: presetSchedule.qaqcScope ?? "", auditTypes: presetSchedule.auditTypes ?? [] } : {}),
  });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [feasibilityOpen, setFeasibilityOpen] = useState(false);
  const [feasibilityFeedback, setFeasibilityFeedback] = useState("");
  const [feasibilityError, setFeasibilityError] = useState("");
  const [feasibilityFromDate, setFeasibilityFromDate] = useState("");
  const [feasibilityToDate, setFeasibilityToDate] = useState("");
  const [feasibilityDateError, setFeasibilityDateError] = useState("");
  const [offlineContext, setOfflineContext] = useState<AuditPlanOfflineContext | null>(null);
  const fc = useFieldControls("audit", "plan"); const ro = (key: string) => fc.fieldProps(key).disabled;
  const create = useCreateAuditPlan(); const update = useUpdateAuditPlan(); const recordFeasibility = useRecordAuditScheduleFeasibility(); const qc = useQueryClient(); const { toast } = useToast();
  const options = useGetAuditPlanOptions();
  const auditeeRoles = useListAuditPlanNotificationRoles();
  const activityMaster = useLov("activities");
  useEffect(() => { void readAuditPlanContext().then(setOfflineContext).catch(() => undefined); }, []);
  useEffect(() => {
    if (options.data?.users && schedules.length) {
      void cacheAuditPlanContext(schedules, options.data.users).then(() => readAuditPlanContext().then(setOfflineContext)).catch(() => undefined);
    }
  }, [options.data, schedules]);
  const users = options.data?.users ?? offlineContext?.users ?? [];
  const effectiveSchedules = navigator.onLine
    ? schedules
    : (schedules.length ? schedules : offlineContext?.schedules ?? []);
  const approvedSchedules = (presetSchedule ? [presetSchedule] : effectiveSchedules)
    .filter(schedule => !schedule.hasPlan && schedule.feasibilityDecision !== "cancelled");
  const selectedSchedule = effectiveSchedules.find(schedule => schedule.id === form.scheduleId) ?? presetSchedule;
  const leadUsers = selectedSchedule?.teamLeadIds == null
    ? users
    : users.filter(user => selectedSchedule.teamLeadIds?.includes(user.id));
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
      leadAuditorId: schedule.teamLeadIds == null || schedule.teamLeadIds.includes(current.leadAuditorId) ? current.leadAuditorId : "",
    }));
    clearError("scheduleId", "auditTitle", "qaqcScope", "auditTypes", "qaqcReference", "leadAuditorId");
  };
  const selectedTeamNames = form.teamMemberIds.map(id => users.find(user => user.id === id)?.fullName).filter(Boolean);
  const selectedAuditeeRoleIds = form.auditeeRoleIds ?? [];
  const selectedAuditeeRoleNames = selectedAuditeeRoleIds.map(id => auditeeRoles.data?.find(role => role.id === id)?.name).filter(Boolean);
  const circulationIds = [...new Set([form.leadAuditorId, ...form.teamMemberIds].filter(Boolean))];
  const circulation = [
    ...circulationIds.map(id => users.find(user => user.id === id)?.fullName).filter(Boolean),
    ...selectedAuditeeRoleNames,
  ].join(", ");
  const toggleTeamMember = (id: string, checked: boolean) => set("teamMemberIds", checked ? [...form.teamMemberIds, id] : form.teamMemberIds.filter(item => item !== id));
  const toggleAuditeeRole = (id: string, checked: boolean) => set("auditeeRoleIds", checked ? [...new Set([...selectedAuditeeRoleIds, id])] : selectedAuditeeRoleIds.filter(item => item !== id));
  const activityRows: AuditPlanActivity[] = form.activities !== undefined ? form.activities : [{
    id: `legacy-${form.id}`, section: form.activitySection, remarks: form.activityRemarks, auditeeId: form.activityAuditeeId,
  }];
  const setActivity = (id: string, key: keyof Omit<AuditPlanActivity, "id">, value: string) => {
    set("activities", activityRows.map(row => row.id === id ? { ...row, [key]: value } : row));
    clearError(`activity-${id}-${key}`, "activities");
  };
  const selectActivity = (id: string, section: string) => {
    const selected = activityMaster.options.find(activity => activity.value === section);
    const remarks = typeof selected?.metadata?.activityDefaultRemarks === "string"
      ? selected.metadata.activityDefaultRemarks : "";
    set("activities", activityRows.map(row => row.id === id ? { ...row, section, remarks } : row));
    clearError(`activity-${id}-section`, `activity-${id}-remarks`, "activities");
  };
  const addActivity = () => set("activities", [...activityRows, { id: crypto.randomUUID(), section: "", remarks: "", auditeeId: "" }]);
  const deleteActivity = (id: string) => set("activities", activityRows.filter(row => row.id !== id));
  const save = () => {
    const required: Array<[keyof AuditPlan | "circulation", unknown]> = [
      ["scheduleId", form.scheduleId], ["auditTitle", form.auditTitle], ["leadAuditorId", form.leadAuditorId],
      ["teamMemberIds", form.teamMemberIds], ["auditeeRoleIds", selectedAuditeeRoleIds], ["qaqcScope", form.qaqcScope],
      ["auditTypes", form.auditTypes], ["auditLanguage", form.auditLanguage], ["qaqcReference", form.qaqcReference],
      ["startDateTime", form.startDateTime], ["endDateTime", form.endDateTime],
      ["openingMeetingDateTime", form.openingMeetingDateTime], ["closingMeetingDateTime", form.closingMeetingDateTime],
      ["activityDateTime", form.activityDateTime], ["circulation", circulation],
    ];
    const nextErrors = Object.fromEntries(required.filter(([, value]) => Array.isArray(value) ? !value.length : !String(value ?? "").trim()).map(([key]) => [key, "This field is required."]));
    if (form.leadAuditorId && !leadUsers.some(user => user.id === form.leadAuditorId)) nextErrors.leadAuditorId = "Select a lead from those chosen when this schedule was created.";
    if (!activityRows.length) nextErrors.activities = "Add at least one activity row.";
    activityRows.forEach(row => {
      if (!row.section.trim()) nextErrors[`activity-${row.id}-section`] = "Select an activity.";
      if (!row.remarks.trim()) nextErrors[`activity-${row.id}-remarks`] = "Enter activity remarks.";
      if (!row.auditeeId) nextErrors[`activity-${row.id}-auditeeId`] = "Select an auditee.";
    });
    activityRows.forEach((row, index) => {
      const section = row.section.trim().toLocaleLowerCase();
      if (section && activityRows.findIndex(candidate => candidate.section.trim().toLocaleLowerCase() === section) !== index) {
        nextErrors[`activity-${row.id}-section`] = "This activity is already selected in another row.";
      }
    });
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
    const firstActivity = activityRows[0];
    const payload = {
      ...form, auditeeId: activityRows[0]?.auditeeId ?? form.auditeeId, activities: activityRows, auditPlanCirculation: circulation,
      activitySection: firstActivity?.section ?? "", activityRemarks: firstActivity?.remarks ?? "",
      activityAuditeeId: firstActivity?.auditeeId ?? "",
    };
    const success = (title: string, updated?: AuditPlan) => {
      qc.invalidateQueries({ queryKey: ["/api/audit/plans"] });
      if (updated) qc.setQueryData(getGetAuditPlanQueryKey(form.id), updated);
      else qc.invalidateQueries({ queryKey: getGetAuditPlanQueryKey(form.id) });
      qc.invalidateQueries({ queryKey: ["/api/audit/schedules"] });
      toast({ title });
      onClose();
    };
    if (initial) {
      update.mutate({ id: form.id, data: payload }, { onSuccess: updated => success("Audit plan updated", updated), onError: e => toast({ title: "Unable to save", description: errorText(e), variant: "destructive" }) });
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
  const submitFeasibility = (decision: "cancelled" | "reschedule") => {
    const feedback = feasibilityFeedback.trim();
    if (!feedback) {
      setFeasibilityError("Remarks / Feedback is required.");
      return;
    }
    if (decision === "reschedule") {
      if (!feasibilityFromDate || !feasibilityToDate) {
        setFeasibilityDateError("From Date and To Date are required to reschedule.");
        return;
      }
      if (feasibilityToDate < feasibilityFromDate) {
        setFeasibilityDateError("To Date must be on or after From Date.");
        return;
      }
    }
    recordFeasibility.mutate({ id: form.scheduleId, data: {
      decision, feedback,
      ...(decision === "reschedule" ? { fromDate: feasibilityFromDate, toDate: feasibilityToDate } : {}),
    } }, {
      onSuccess: () => {
        qc.invalidateQueries({ queryKey: ["/api/audit/schedules"] });
        toast({ title: decision === "cancelled" ? "Audit cancelled" : "Audit dates rescheduled" });
        setFeasibilityOpen(false);
        onClose();
      },
      onError: error => toast({ title: "Unable to update audit feasibility", description: errorText(error), variant: "destructive" }),
    });
  };
  return <div className="grid gap-4 py-2">
    {!navigator.onLine && <div className="rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">You are offline. This plan will be saved on this device and synchronized automatically when the network returns.</div>}
    <div className="rounded-lg border bg-muted/30 p-4"><Label>Source Audit *</Label><Select value={form.scheduleId} disabled={disabled("scheduleId")} onValueChange={selectSchedule}><SelectTrigger className="mt-2" {...invalid("scheduleId")}><SelectValue placeholder="Select an audit"/></SelectTrigger><SelectContent>{approvedSchedules.map(schedule => <SelectItem key={schedule.id} value={schedule.id}>{schedule.title}</SelectItem>)}</SelectContent></Select><ErrorText name="scheduleId"/>{!approvedSchedules.length && <p className="mt-2 text-xs text-muted-foreground">{navigator.onLine ? "No Audits are available for a new Plan." : "No Audits are available offline. Connect once to cache current schedule data."}</p>}</div>
    <div><Label>1. Audit Feasible *</Label><RadioGroup className="mt-2 flex gap-6" value={form.auditFeasible ? "yes" : "no"} disabled={disabled("auditFeasible")} onValueChange={value => { const feasible = value === "yes"; set("auditFeasible", feasible); if (!feasible) setFeasibilityOpen(true); }}><div className="flex items-center gap-2"><RadioGroupItem value="yes" id="plan-feasible-yes"/><Label htmlFor="plan-feasible-yes">Yes</Label></div><div className="flex items-center gap-2"><RadioGroupItem value="no" id="plan-feasible-no"/><Label htmlFor="plan-feasible-no">No</Label></div></RadioGroup></div>
    <Dialog open={feasibilityOpen} onOpenChange={open => { setFeasibilityOpen(open); if (!open) setForm(current => ({ ...current, auditFeasible: true })); }}><DialogContent><DialogHeader><DialogTitle>Audit is not feasible</DialogTitle><DialogDescription>Enter the required feedback. New dates are required only to reschedule the audit; canceling does not require dates.</DialogDescription></DialogHeader><div><Label htmlFor="feasibility-feedback">Remarks / Feedback *</Label><Textarea id="feasibility-feedback" className="mt-2" rows={5} value={feasibilityFeedback} aria-invalid={!!feasibilityError} onChange={event => { setFeasibilityFeedback(event.target.value); setFeasibilityError(""); }} placeholder="Enter remarks or feedback"/>{feasibilityError && <p className="mt-1 text-sm text-destructive">{feasibilityError}</p>}</div><div className="grid gap-3 sm:grid-cols-2"><div><Label htmlFor="feasibility-from-date">From Date</Label><Input id="feasibility-from-date" type="date" className="mt-2" value={feasibilityFromDate} aria-invalid={!!feasibilityDateError} onChange={event => { setFeasibilityFromDate(event.target.value); setFeasibilityDateError(""); }}/></div><div><Label htmlFor="feasibility-to-date">To Date</Label><Input id="feasibility-to-date" type="date" className="mt-2" min={feasibilityFromDate || undefined} value={feasibilityToDate} aria-invalid={!!feasibilityDateError} onChange={event => { setFeasibilityToDate(event.target.value); setFeasibilityDateError(""); }}/></div>{feasibilityDateError && <p className="text-sm text-destructive sm:col-span-2">{feasibilityDateError}</p>}</div><DialogFooter><Button variant="destructive" disabled={recordFeasibility.isPending} onClick={() => submitFeasibility("cancelled")}>Cancel Audit</Button><Button disabled={recordFeasibility.isPending} onClick={() => submitFeasibility("reschedule")}>Reschedule Audit</Button></DialogFooter></DialogContent></Dialog>
    <fieldset disabled={!form.auditFeasible} className={`grid gap-4 ${!form.auditFeasible ? "opacity-50" : ""}`}>
    <div><Label>2. Audit Title *</Label><Input className="mt-2" readOnly disabled={readOnly} value={form.auditTitle} {...invalid("auditTitle")} placeholder="Generated from Audit Schedule"/><ErrorText name="auditTitle"/></div>
    <div><Label>3. Lead / Internal Auditor *</Label><Select value={form.leadAuditorId} disabled={disabled("leadAuditorId") || !form.scheduleId} onValueChange={value => set("leadAuditorId", value)}><SelectTrigger className="mt-2" {...invalid("leadAuditorId")}><SelectValue placeholder="Select lead auditor"/></SelectTrigger><SelectContent>{leadUsers.map(user => <SelectItem key={user.id} value={user.id}>{user.fullName}{user.designation ? ` — ${user.designation}` : ""}</SelectItem>)}</SelectContent></Select><ErrorText name="leadAuditorId"/>{form.scheduleId && selectedSchedule?.teamLeadIds != null && !leadUsers.length && <p className="mt-1 text-xs text-muted-foreground">No selected Audit Team Leads currently have active Audit access.</p>}</div>
    <div><Label>4. Audit Team *</Label><DropdownMenu><DropdownMenuTrigger asChild><Button type="button" variant="outline" className="mt-2 w-full justify-between font-normal" disabled={disabled("teamMemberIds")} {...invalid("teamMemberIds")}><span className="truncate">{selectedTeamNames.length ? selectedTeamNames.join(", ") : "Select Audit Team"}</span><ChevronDown className="ml-2 size-4 shrink-0"/></Button></DropdownMenuTrigger><DropdownMenuContent className="w-[var(--radix-dropdown-menu-trigger-width)]">{users.map(user => <DropdownMenuCheckboxItem key={user.id} checked={form.teamMemberIds.includes(user.id)} onSelect={event => event.preventDefault()} onCheckedChange={checked => toggleTeamMember(user.id, checked === true)}>{user.fullName}{user.designation ? ` — ${user.designation}` : ""}</DropdownMenuCheckboxItem>)}</DropdownMenuContent></DropdownMenu><ErrorText name="teamMemberIds"/></div>
    <div><Label>5. Auditee Roles *</Label><DropdownMenu><DropdownMenuTrigger asChild><Button type="button" variant="outline" className="mt-2 w-full justify-between font-normal" disabled={disabled("auditeeId") || auditeeRoles.isLoading} {...invalid("auditeeRoleIds")}><span className="truncate">{selectedAuditeeRoleNames.length ? selectedAuditeeRoleNames.join(", ") : auditeeRoles.isLoading ? "Loading roles…" : "Select auditee roles"}</span><ChevronDown className="ml-2 size-4 shrink-0"/></Button></DropdownMenuTrigger><DropdownMenuContent className="w-[var(--radix-dropdown-menu-trigger-width)]">{(auditeeRoles.data ?? []).map(role => <DropdownMenuCheckboxItem key={role.id} checked={selectedAuditeeRoleIds.includes(role.id)} onSelect={event => event.preventDefault()} onCheckedChange={checked => toggleAuditeeRole(role.id, checked === true)}>{role.name}</DropdownMenuCheckboxItem>)}</DropdownMenuContent></DropdownMenu><ErrorText name="auditeeRoleIds"/></div>
    <div><Label>6. QA/QC Scope *</Label><Textarea className="mt-2" readOnly disabled={readOnly} value={form.qaqcScope} {...invalid("qaqcScope")} placeholder="Prefilled from Audit Schedule"/><ErrorText name="qaqcScope"/></div>
    <div><Label>7. Audit Type *</Label><Input className="mt-2" readOnly disabled={readOnly} value={form.auditTypes.join(", ")} {...invalid("auditTypes")} placeholder="Prefilled from Audit Schedule"/><ErrorText name="auditTypes"/></div>
    <div><Label>8. Audit Language *</Label><Textarea className="mt-2" readOnly disabled={readOnly} value={form.auditLanguage} {...invalid("auditLanguage")}/><ErrorText name="auditLanguage"/></div>
    <div><Label>9. QA/QC References *</Label><Select value={form.qaqcReference} disabled={readOnly || !form.scheduleId || ro("qaqcReference")} onValueChange={value => set("qaqcReference", value)}><SelectTrigger className="mt-2" {...invalid("qaqcReference")}><SelectValue placeholder="Select QA/QC reference"/></SelectTrigger><SelectContent>{form.qaqcReference && <SelectItem value={form.qaqcReference}>{form.qaqcReference}</SelectItem>}</SelectContent></Select><ErrorText name="qaqcReference"/></div>
    <div><Label>10. Description of Audit</Label><Textarea className="mt-2" value={form.description ?? ""} disabled={disabled("description")} onChange={event => set("description", event.target.value)} placeholder="Optional"/></div>
    <div><Label>11. Start Date & Time *</Label><Input className="mt-2" type="datetime-local" value={form.startDateTime.slice(0,16)} disabled={disabled("startDateTime")} {...invalid("startDateTime")} onChange={event => set("startDateTime", event.target.value)}/><ErrorText name="startDateTime"/></div>
    <div><Label>12. End Date & Time *</Label><Input className="mt-2" type="datetime-local" value={form.endDateTime.slice(0,16)} disabled={disabled("endDateTime")} {...invalid("endDateTime")} onChange={event => set("endDateTime", event.target.value)}/><ErrorText name="endDateTime"/></div>
    <div><Label>13. Opening Meeting *</Label><Input className="mt-2" type="datetime-local" value={form.openingMeetingDateTime.slice(0,16)} disabled={disabled("openingMeetingDateTime")} {...invalid("openingMeetingDateTime")} onChange={event => set("openingMeetingDateTime", event.target.value)}/><ErrorText name="openingMeetingDateTime"/></div>
    <div><Label>14. Closing Meeting *</Label><Input className="mt-2" type="datetime-local" value={form.closingMeetingDateTime.slice(0,16)} disabled={disabled("closingMeetingDateTime")} {...invalid("closingMeetingDateTime")} onChange={event => set("closingMeetingDateTime", event.target.value)}/><ErrorText name="closingMeetingDateTime"/></div>
    <div className="space-y-3"><div className="flex flex-wrap items-center justify-between gap-2"><div><Label>15–17. Activity Details *</Label><p className="mt-1 text-xs text-muted-foreground">Add one row for each Activities master-data value required in this plan.</p></div>{!readOnly && <Button type="button" variant="outline" size="sm" onClick={addActivity} disabled={ro("activitySection") || ro("activityRemarks") || ro("activityAuditeeId")}><Plus className="mr-2 size-4"/>Add row</Button>}</div>
      <div className="overflow-x-auto rounded-lg border"><Table><TableHeader><TableRow><TableHead className="min-w-56">15. Activities / Section</TableHead><TableHead className="min-w-72">16. Activities / Section Remarks</TableHead><TableHead className="min-w-56">17. Auditee for the Activity</TableHead>{!readOnly && <TableHead className="w-16 text-right">Action</TableHead>}</TableRow></TableHeader><TableBody>
        {activityRows.map(row => <TableRow key={row.id}><TableCell className="align-top"><Select value={row.section} disabled={disabled("activitySection") || activityMaster.isLoading} onValueChange={value => selectActivity(row.id, value)}><SelectTrigger {...invalid(`activity-${row.id}-section`)}><SelectValue placeholder={activityMaster.isLoading ? "Loading activities…" : "Select activity"}/></SelectTrigger><SelectContent>{activityMaster.options.map(activity => <SelectItem key={activity.value} value={activity.value} disabled={activity.value !== row.section && activityRows.some(candidate => candidate.section === activity.value)}>{activity.label}</SelectItem>)}</SelectContent></Select><ErrorText name={`activity-${row.id}-section`}/></TableCell>
          <TableCell className="align-top"><Textarea rows={3} value={row.remarks} disabled={disabled("activityRemarks")} {...invalid(`activity-${row.id}-remarks`)} onChange={event => setActivity(row.id, "remarks", event.target.value)} placeholder="Enter remarks"/><ErrorText name={`activity-${row.id}-remarks`}/></TableCell>
          <TableCell className="align-top"><Select value={row.auditeeId} disabled={readOnly || ro("activityAuditeeId")} onValueChange={value => setActivity(row.id, "auditeeId", value)}><SelectTrigger {...invalid(`activity-${row.id}-auditeeId`)}><SelectValue placeholder="Select activity auditee"/></SelectTrigger><SelectContent>{users.map(user => <SelectItem key={user.id} value={user.id}>{user.fullName}{user.designation ? ` — ${user.designation}` : ""}</SelectItem>)}</SelectContent></Select><ErrorText name={`activity-${row.id}-auditeeId`}/></TableCell>
          {!readOnly && <TableCell className="align-top text-right"><Button type="button" size="icon" variant="ghost" aria-label="Delete activity row" onClick={() => deleteActivity(row.id)} disabled={ro("activitySection") || ro("activityRemarks") || ro("activityAuditeeId")}><Trash2 className="size-4"/></Button></TableCell>}</TableRow>)}
        {!activityRows.length && <TableRow><TableCell colSpan={readOnly ? 3 : 4} className="py-8 text-center text-sm text-muted-foreground">No activity rows. Add the first activity.</TableCell></TableRow>}
      </TableBody></Table></div><ErrorText name="activities"/></div>
    <div><Label>18. Date / Time of Activity *</Label><Input className="mt-2" type="datetime-local" value={form.activityDateTime.slice(0,16)} disabled={disabled("activityDateTime")} {...invalid("activityDateTime")} onChange={event => set("activityDateTime", event.target.value)}/><ErrorText name="activityDateTime"/></div>
    <div><Label>19. Audit Plan Circulation *</Label><Textarea className="mt-2" readOnly disabled={readOnly} value={circulation} {...invalid("circulation")} placeholder="Generated from selected Master users"/><ErrorText name="circulation"/></div>
    </fieldset>
    <DialogFooter><Button variant="outline" onClick={onClose}>{readOnly ? "Back to plans" : "Cancel"}</Button>{!readOnly && <Button onClick={save} disabled={!form.auditFeasible || create.isPending || update.isPending}>{initial ? "Save changes" : "Create Plan"}</Button>}</DialogFooter>
  </div>;
}

function SendForAuditDialog({ plan, open, onOpenChange, onSent }: {
  plan?: AuditPlan;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSent: () => void;
}) {
  const [roleIds, setRoleIds] = useState<string[]>([]);
  const roles = useListAuditPlanNotificationRoles();
  const sendForAudit = useSendAuditPlanForExecution();
  const { toast } = useToast();
  useEffect(() => {
    if (open) setRoleIds([]);
  }, [open, plan?.id]);
  const toggleRole = (roleId: string, checked: boolean) => {
    setRoleIds(current => checked ? [...new Set([...current, roleId])] : current.filter(id => id !== roleId));
  };
  const submit = () => {
    if (!plan || !roleIds.length) return;
    sendForAudit.mutate({ id: plan.id, data: { roleIds } }, {
      onSuccess: () => {
        onOpenChange(false);
        onSent();
      },
      onError: error => toast({ title: "Unable to send for audit", description: errorText(error), variant: "destructive" }),
    });
  };
  return <Dialog open={open} onOpenChange={onOpenChange}>
    <DialogContent className="max-w-lg">
      <DialogHeader>
        <DialogTitle>Send for Audit</DialogTitle>
        <DialogDescription>Select the roles that need to be informed when this Audit Plan is sent to Audit Execution.</DialogDescription>
      </DialogHeader>
      <div className="max-h-72 space-y-2 overflow-y-auto rounded-md border p-3">
        {roles.isLoading && <p className="py-4 text-center text-sm text-muted-foreground">Loading roles…</p>}
        {roles.error && <p className="py-4 text-center text-sm text-destructive">{errorText(roles.error)}</p>}
        {(roles.data ?? []).map(role => <label key={role.id} className="flex cursor-pointer items-start gap-3 rounded-md p-2 hover:bg-muted">
          <Checkbox checked={roleIds.includes(role.id)} onCheckedChange={checked => toggleRole(role.id, checked === true)} />
          <span>
            <span className="block text-sm font-medium">{role.name}</span>
            {role.description && <span className="block text-xs text-muted-foreground">{role.description}</span>}
          </span>
        </label>)}
        {!roles.isLoading && !roles.error && !(roles.data?.length) && <p className="py-4 text-center text-sm text-muted-foreground">No active roles are available.</p>}
      </div>
      {!roleIds.length && <p className="text-xs text-muted-foreground">Select at least one role to continue.</p>}
      <DialogFooter>
        <Button variant="outline" onClick={() => onOpenChange(false)} disabled={sendForAudit.isPending}>Cancel</Button>
        <Button onClick={submit} disabled={!roleIds.length || roles.isLoading || sendForAudit.isPending}>{sendForAudit.isPending ? "Submitting…" : "Submit"}</Button>
      </DialogFooter>
    </DialogContent>
  </Dialog>;
}

function Plans() {
  const [page, setPage] = useState(1); const [open, setOpen] = useState(false); const [search, setSearch] = useState(""); const [sendPlan, setSendPlan] = useState<AuditPlan>();
  const [, navigate] = useLocation();
  const query = useListAuditPlans({ page, limit: PAGE_SIZE }); const knownPlans = useListAuditPlans({ page: 1, limit: 100 }); const schedules = useListAuditSchedules({ page: 1, limit: 100 }); const openAudit = useSendAuditPlanForExecution(); const remove = useDeleteAuditPlan(); const qc = useQueryClient(); const { toast } = useToast();
  const items = (query.data?.items ?? []).filter(x => x.auditTitle.toLowerCase().includes(search.toLowerCase()));
  const occupiedScheduleIds = new Set((knownPlans.data?.items ?? []).map(plan => plan.scheduleId));
  const availableSchedules = (schedules.data?.items ?? []).filter(schedule =>
    !schedule.hasPlan && !occupiedScheduleIds.has(schedule.id) && schedule.feasibilityDecision !== "cancelled");
  const refresh = (title: string) => {
    qc.invalidateQueries({ queryKey: ["/api/audit/plans"] });
    qc.invalidateQueries({ queryKey: ["/api/audit/schedules"] });
    qc.invalidateQueries({ queryKey: ["/api/audit/audits"] });
    toast({ title });
  };
  return <div className="space-y-5"><PageHeader title="Audit plans" description="Define the Stage 2 Audit Planning programme" action={<Dialog open={open} onOpenChange={setOpen}><DialogTrigger asChild><Button><Plus className="mr-2 size-4"/>New plan</Button></DialogTrigger><DialogContent className="max-h-[90vh] max-w-3xl overflow-y-auto"><DialogHeader><DialogTitle>Create Audit Plan</DialogTitle></DialogHeader><PlanForm schedules={availableSchedules} onClose={() => setOpen(false)}/></DialogContent></Dialog>}/><Input className="max-w-sm" placeholder="Search audit title…" value={search} onChange={e => setSearch(e.target.value)}/><State loading={query.isLoading} error={query.error} empty={!items.length}/>
    <div className="grid gap-4 md:grid-cols-2">{items.map(plan => <Card key={plan.id}><CardHeader><div className="flex justify-between gap-2"><CardTitle className="text-base"><Link className="underline-offset-4 hover:underline" href={`/audit/plans/${plan.id}`}>{plan.auditTitle}</Link></CardTitle><Badge variant={workflowTone(plan.status)}>{plan.status}</Badge></div><CardDescription>{date(plan.startDateTime)} · {plan.activitySection}</CardDescription></CardHeader><CardContent className="space-y-3 text-sm"><p><b>Audit type:</b> {plan.auditTypes.join(", ")}</p><p><b>Team:</b> {plan.teamMemberIds.length} member(s)</p><p className="text-muted-foreground">{plan.description || plan.activityRemarks}</p><div className="flex flex-wrap justify-end gap-2"><Button size="sm" variant="outline" asChild><Link href={`/audit/plans/${plan.id}`}>{plan.status === "Draft" ? <Pencil className="mr-2 size-4"/> : <Eye className="mr-2 size-4"/>}{plan.status === "Draft" ? "Edit" : "View"}</Link></Button>{plan.status === "Draft" && <Button size="sm" onClick={() => setSendPlan(plan)}><Send className="mr-2 size-4"/>Send for Audit</Button>}<Button size="sm" variant="outline" disabled={plan.status === "Draft" || openAudit.isPending} title={plan.status === "Draft" ? "Send this plan for audit first" : "Open Audit Execution"} onClick={() => openAudit.mutate({ id: plan.id, data: { roleIds: [] } }, { onSuccess: audit => navigate(`/audit/audits/${audit.id}`), onError: error => toast({ title: "Unable to open Audit Execution", description: errorText(error), variant: "destructive" }) })}><ClipboardCheck className="mr-2 size-4"/>Audit</Button><Button size="icon" variant="ghost" onClick={() => window.confirm("Soft-delete this plan?") && remove.mutate({ id: plan.id }, { onSuccess: () => refresh("Plan deleted") })}><Trash2 className="size-4"/></Button></div></CardContent></Card>)}</div>
    <SendForAuditDialog plan={sendPlan} open={!!sendPlan} onOpenChange={isOpen => !isOpen && setSendPlan(undefined)} onSent={() => refresh("Audit sent to Audit Execution")} />
    {items.length > 0 && <Pager page={page} total={query.data?.total ?? 0} onPage={setPage}/>}</div>;
}

function PlanDetail() {
  const { id = "" } = useParams<{ id: string }>();
  const [, navigate] = useLocation();
  const [sendOpen, setSendOpen] = useState(false);
  const query = useGetAuditPlan(id);
  const schedules = useListAuditSchedules({ page: 1, limit: 100 });
  const qc = useQueryClient();
  const { toast } = useToast();
  if (query.isLoading || query.error || !query.data) return <div className="space-y-4"><Button variant="ghost" asChild><Link href="/audit/plans"><ArrowLeft className="mr-2 size-4"/>Audit plans</Link></Button><State loading={query.isLoading} error={query.error} empty={!query.data}/></div>;
  const plan = query.data;
  const editable = plan.status === "Draft";
  return <div className="space-y-5"><Button variant="ghost" asChild><Link href="/audit/plans"><ArrowLeft className="mr-2 size-4"/>Audit plans</Link></Button><PageHeader title={plan.auditTitle} description={editable ? "Draft Audit Plan · editable" : `${plan.status} Audit Plan · read-only`} action={<div className="flex items-center gap-2">{editable && <Button onClick={() => setSendOpen(true)}><Send className="mr-2 size-4"/>Send for Audit</Button>}<Badge variant={workflowTone(plan.status)}>{plan.status}</Badge></div>}/><Card><CardContent className="pt-6"><PlanForm initial={plan} readOnly={!editable} schedules={schedules.data?.items ?? []} onClose={() => navigate("/audit/plans")}/></CardContent></Card><SendForAuditDialog plan={plan} open={sendOpen} onOpenChange={setSendOpen} onSent={() => { qc.invalidateQueries({ queryKey: ["/api/audit/plans"] }); qc.invalidateQueries({ queryKey: ["/api/audit/audits"] }); void query.refetch(); toast({ title: "Audit sent to Audit Execution" }); }} /></div>;
}

function Audits() {
  const [page, setPage] = useState(1); const [search, setSearch] = useState(""); const query = useListAudits({ page, limit: PAGE_SIZE });
  const items = (query.data?.items ?? []).filter(x => x.title.toLowerCase().includes(search.toLowerCase()));
  return <div className="space-y-5"><PageHeader title="Audit execution" description="Open an audit to run meetings, checklist, findings and evidence"/><div className="relative max-w-sm"><Search className="absolute left-3 top-2.5 size-4 text-muted-foreground"/><Input className="pl-9" placeholder="Search audits…" value={search} onChange={e=>setSearch(e.target.value)}/></div><State loading={query.isLoading} error={query.error} empty={!items.length}/><div className="grid gap-4 md:grid-cols-2">{items.map(a => <Card key={a.id}><CardHeader><div className="flex justify-between"><CardTitle className="text-base">{a.title}</CardTitle><Badge variant={workflowTone(a.status)}>{a.status}</Badge></div><CardDescription>Started {date(a.startedAt)}</CardDescription></CardHeader><CardContent className="flex justify-end gap-2"><Button variant="outline" asChild><Link href={`/audit/audits/${a.id}/report`}>Report</Link></Button><Button asChild><Link href={`/audit/audits/${a.id}`}>Open workspace</Link></Button></CardContent></Card>)}</div>{items.length > 0 && <Pager page={page} total={query.data?.total ?? 0} onPage={setPage}/>}</div>;
}

function meetingAttendeeLabel(id: string, users: Array<{ id: string; fullName: string }>) {
  return users.find(user => user.id === id)?.fullName ?? (/^[0-9a-f]{8}-[0-9a-f-]{27,}$/i.test(id) ? "Former Audit user" : id);
}

function MeetingEditor({ auditId, kind, value }: { auditId: string; kind: "opening" | "closing"; value?: MeetingMinutes }) {
  const [form, setForm] = useState<MeetingMinutes>(value ?? { heldAt: "", attendees: [], minutes: "" });
  const [attendeePickerOpen, setAttendeePickerOpen] = useState(false);
  const qc = useQueryClient(); const { toast } = useToast();
  const fa = useFieldAccess("audit"); const locked = fa.readOnly("audit-execution", `${kind}Meeting`);
  const opening = useUpdateAuditOpeningMeeting(); const closing = useUpdateAuditClosingMeeting();
  const attendeeOptions = useListAuditMeetingAttendees(auditId);
  const users = attendeeOptions.data ?? [];
  const toggleAttendee = (id: string) => setForm(current => ({
    ...current, attendees: current.attendees.includes(id)
      ? current.attendees.filter(value => value !== id) : [...current.attendees, id],
  }));
  const save = () => {
    if (!form.heldAt || !form.minutes) { toast({ title: "Date and minutes are required", variant: "destructive" }); return; }
    const mutation = kind === "opening" ? opening : closing;
    mutation.mutate({ id: auditId, data: form }, {
      onSuccess: () => { void qc.invalidateQueries({ queryKey: [`/api/audit/audits/${auditId}`] }); toast({ title: `${kind === "opening" ? "Opening" : "Closing"} minutes saved` }); },
      onError: error => toast({ title: "Unable to save meeting minutes", description: errorText(error), variant: "destructive" }),
    });
  };
  return <Card><CardHeader><CardTitle className="capitalize">{kind} meeting minutes</CardTitle></CardHeader><CardContent className="space-y-4">
    <div><Label>Held at</Label><Input type="datetime-local" value={form.heldAt?.slice(0,16)} disabled={locked} onChange={e=>setForm(v=>({...v,heldAt:e.target.value}))}/></div>
    <div className="space-y-2">
      <Label id={`${kind}-meeting-attendees`}>Attendees</Label>
      <Popover open={attendeePickerOpen} onOpenChange={setAttendeePickerOpen}>
        <PopoverTrigger asChild><Button type="button" variant="outline" role="combobox" aria-labelledby={`${kind}-meeting-attendees`} aria-expanded={attendeePickerOpen} disabled={locked || attendeeOptions.isLoading || !!attendeeOptions.error} className="w-full justify-between font-normal">{attendeeOptions.isLoading ? "Loading Audit users…" : `Select Audit users${form.attendees.length ? ` (${form.attendees.length} selected)` : ""}`}<ChevronDown className="ml-2 size-4 opacity-50"/></Button></PopoverTrigger>
        <PopoverContent align="start" className="w-[min(28rem,calc(100vw-2rem))] p-0"><Command><CommandInput placeholder="Search Audit users…"/><CommandList><CommandEmpty>No matching Audit users.</CommandEmpty><CommandGroup>{users.map(user => <CommandItem key={user.id} value={`${user.fullName} ${user.designation ?? ""} ${user.id}`} onSelect={() => toggleAttendee(user.id)}><Check className={`mr-2 size-4 ${form.attendees.includes(user.id) ? "opacity-100" : "opacity-0"}`}/><span>{user.fullName}{user.designation ? <span className="text-muted-foreground"> — {user.designation}</span> : null}</span></CommandItem>)}</CommandGroup></CommandList></Command></PopoverContent>
      </Popover>
      {attendeeOptions.error && <p className="text-sm text-destructive">Unable to load Audit users. <button type="button" className="underline" onClick={() => void attendeeOptions.refetch()}>Retry</button></p>}
      {form.attendees.length > 0 && <div className="flex flex-wrap gap-2">{form.attendees.map(id => <Badge key={id} variant="secondary" className="gap-1.5 py-1">{meetingAttendeeLabel(id, users)}{!locked && <button type="button" aria-label={`Remove ${meetingAttendeeLabel(id, users)}`} onClick={() => toggleAttendee(id)}><XCircle className="size-3.5"/></button>}</Badge>)}</div>}
    </div>
    <div><Label>Minutes</Label><Textarea rows={8} value={form.minutes} disabled={locked} onChange={e=>setForm(v=>({...v,minutes:e.target.value}))}/></div><Button onClick={save} disabled={locked || opening.isPending || closing.isPending || attendeeOptions.isLoading || !!attendeeOptions.error}>Save minutes</Button>
  </CardContent></Card>;
}

function Checklist({ auditId, initial }: { auditId: string; initial: ChecklistItem[] }) {
  const empty = () => ({ clause: "", auditArea: "", question: "", description: "", auditFinding: "", evidenceIds: [] as string[], file: null as File | null });
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<ChecklistItem | null>(null);
  const [draft, setDraft] = useState(empty);
  const [saving, setSaving] = useState(false);
  const [importing, setImporting] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const uploadInput = useRef<HTMLInputElement>(null);
  const [uploadedId, setUploadedId] = useState<string | null>(null);
  const uploadReference = useRef(crypto.randomUUID());
  const qc = useQueryClient();
  const { toast } = useToast();
  const areas = useLov("Audit Area");
  const evidence = useListAuditEvidence({ recordType: "audit", recordId: auditId, page: 1, limit: 200 });
  const addItem = useCreateAuditChecklistItem();
  const editItem = useEditAuditChecklistItem();
  const importItems = useImportAuditChecklistItems();
  const intent = useCreateAuditEvidenceIntent();
  const confirm = useConfirmAuditEvidence();
  const update = (key: keyof ReturnType<typeof empty>, value: string | File | null | string[]) => setDraft(current => ({ ...current, [key]: value }));
  const reset = () => { setOpen(false); setEditing(null); setDraft(empty()); setUploadedId(null); uploadReference.current = crypto.randomUUID(); };
  const openEdit = (item: ChecklistItem) => {
    setEditing(item);
    setDraft({
      clause: item.clause ?? "", auditArea: item.auditArea ?? "", question: item.question,
      description: item.description ?? item.notes ?? "",
      auditFinding: item.auditFinding ?? (checklistFindings.find(value => value === item.result) ?? ""),
      evidenceIds: item.evidenceIds ?? [], file: null,
    });
    setUploadedId(null);
    uploadReference.current = crypto.randomUUID();
    setOpen(true);
  };
  const download = async () => {
    setDownloading(true);
    try { await downloadChecklistWorkbook(areas.options, initial); }
    catch (error) { toast({ title: "Unable to download template", description: errorText(error), variant: "destructive" }); }
    finally { setDownloading(false); }
  };
  const importFile = async (file: File) => {
    setImporting(true);
    try {
      if (file.size > 5 * 1024 * 1024) throw new Error("The Excel file exceeds the 5 MB import limit.");
      const rows = parseChecklistWorkbook(await file.arrayBuffer(), areas.options, initial);
      const saved = await importItems.mutateAsync({ id: auditId, data: rows });
      qc.setQueryData(getGetAuditQueryKey(auditId), saved);
      void qc.invalidateQueries({ queryKey: getGetAuditQueryKey(auditId) });
      const updates = rows.filter(row => row.id).length;
      const additions = rows.length - updates;
      toast({ title: `Checklist loaded`, description: `${updates} updated, ${additions} added.` });
    } catch (error) {
      toast({ title: "Unable to import checklist", description: errorText(error), variant: "destructive" });
    } finally {
      if (uploadInput.current) uploadInput.current.value = "";
      setImporting(false);
    }
  };
  const downloadEvidence = async (storageUrl: string, fileName: string) => {
    try {
      const blob = await customFetch<Blob>(storageUrl, { responseType: "blob" });
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = fileName;
      link.click();
      window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
    } catch (error) {
      toast({ title: "Unable to download evidence", description: errorText(error), variant: "destructive" });
    }
  };
  const save = async () => {
    if (!draft.clause.trim() || !draft.auditArea || !draft.question.trim()) {
      toast({ title: "Clause, Audit Area and Audit Question are required", variant: "destructive" });
      return;
    }
    if (!areas.options.some(area => area.value === draft.auditArea)) {
      toast({ title: "Select an active Audit Area from master data", variant: "destructive" });
      return;
    }
    setSaving(true);
    try {
      let fileId = uploadedId;
      if (draft.file && !fileId) {
        const type = draft.file.type || "application/octet-stream";
        const upload = await intent.mutateAsync({ data: {
          recordType: "audit", recordId: auditId, category: type.startsWith("image/") ? "image" : "document",
          fileName: draft.file.name, mimeType: type, sizeBytes: draft.file.size,
          clientReference: uploadReference.current,
        } });
        await customFetch(upload.uploadUrl, { method: "PUT", body: draft.file, headers: { "Content-Type": type } });
        await confirm.mutateAsync({ id: upload.id });
        fileId = upload.id;
        setUploadedId(fileId);
      }
      const data = {
        clause: draft.clause.trim(), auditArea: draft.auditArea, question: draft.question.trim(),
        description: draft.description.trim(), ...(draft.auditFinding ? { auditFinding: draft.auditFinding as "Minor NC" | "Moderate NC" | "Major NC" | "OFI" | "Not applicable" } : {}),
        evidenceIds: [...new Set([...draft.evidenceIds, ...(fileId ? [fileId] : [])])],
      };
      const saved = editing
        ? await editItem.mutateAsync({ id: auditId, itemId: editing.id, data })
        : await addItem.mutateAsync({ id: auditId, data });
      qc.setQueryData(getGetAuditQueryKey(auditId), saved);
      void qc.invalidateQueries({ queryKey: getGetAuditQueryKey(auditId) });
      if (fileId) void qc.invalidateQueries({ queryKey: ["/api/audit/evidence"] });
      toast({ title: editing ? "Checklist item updated" : "Checklist item saved" });
      reset();
    } catch (error) {
      toast({ title: "Unable to save checklist item", description: errorText(error), variant: "destructive" });
    } finally {
      setSaving(false);
    }
  };
  const findings = checklistFindings;
  const filesById = new Map((evidence.data?.items ?? []).map(file => [file.id, file]));
  return <Card>
    <CardHeader className="flex-row flex-wrap items-center justify-between gap-3">
      <div><CardTitle>Checklist</CardTitle><CardDescription>Clause-level audit questions and findings</CardDescription></div>
      <div className="flex flex-wrap gap-2">
        <Button variant="outline" disabled={downloading || areas.isLoading || !!areas.error || !areas.options.length} onClick={() => void download()}><Download className="mr-2 size-4"/>{downloading ? "Preparing…" : "Download Template"}</Button>
        <Button variant="outline" disabled={importing || areas.isLoading || !!areas.error || !areas.options.length} onClick={() => uploadInput.current?.click()}><Upload className="mr-2 size-4"/>{importing ? "Importing…" : "Upload Excel"}</Button>
        <input ref={uploadInput} className="hidden" type="file" accept=".xlsx" onChange={event => { const file = event.target.files?.[0]; if (file) void importFile(file); }}/>
        <Button onClick={() => { setEditing(null); setDraft(empty()); setOpen(true); }}><Plus className="mr-2 size-4"/>New Item</Button>
      </div>
    </CardHeader>
    <CardContent>
      <div className="overflow-x-auto rounded-md border">
        <Table className="min-w-[1050px]">
          <TableHeader><TableRow><TableHead>Clause</TableHead><TableHead>Audit Area</TableHead><TableHead>Audit Question</TableHead><TableHead>Description</TableHead><TableHead>Audit Findings</TableHead><TableHead>Evidence</TableHead><TableHead>Actions</TableHead></TableRow></TableHeader>
          <TableBody>{initial.length ? initial.map(item => <TableRow key={item.id}>
            <TableCell className="align-top">{item.clause || "—"}</TableCell>
            <TableCell className="align-top">{areas.options.find(area => area.value === item.auditArea)?.label ?? item.auditArea ?? "—"}</TableCell>
            <TableCell className="min-w-56 whitespace-normal align-top">{item.question}</TableCell>
            <TableCell className="min-w-56 whitespace-pre-wrap align-top">{item.description || item.notes || "—"}</TableCell>
            <TableCell className="align-top">{item.auditFinding || item.result || "—"}</TableCell>
            <TableCell className="align-top">{item.evidenceIds?.length ? item.evidenceIds.map(id => {
              const file = filesById.get(id);
              return file?.storageUrl
                ? <button key={id} type="button" className="block text-left text-primary underline" onClick={() => void downloadEvidence(file.storageUrl!, file.fileName)}>{file.fileName}</button>
                : <span key={id} className="block text-muted-foreground">File unavailable</span>;
            }) : "—"}</TableCell>
            <TableCell className="align-top"><Button size="sm" variant="outline" onClick={() => openEdit(item)}><Pencil className="mr-2 size-3"/>Edit</Button></TableCell>
          </TableRow>) : <TableRow><TableCell colSpan={7} className="py-10 text-center text-muted-foreground">No checklist items yet. Select New Item or upload an Excel template to add some.</TableCell></TableRow>}</TableBody>
        </Table>
      </div>
    </CardContent>
    <Dialog open={open} onOpenChange={value => { if (!value && !saving) reset(); else if (value) setOpen(true); }}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-xl">
        <DialogHeader><DialogTitle>{editing ? "Edit Checklist Item" : "New Checklist Item"}</DialogTitle><DialogDescription>{editing ? "Update this question and its evidence." : "Add a question and optionally attach evidence. Nothing is saved until you select Save."}</DialogDescription></DialogHeader>
        <div className="space-y-4">
          <div><Label htmlFor="checklist-clause">Clause *</Label><Input id="checklist-clause" value={draft.clause} onChange={event => update("clause", event.target.value)} placeholder="Enter audit clause"/></div>
          <div><Label>Audit Area *</Label><Select value={draft.auditArea} onValueChange={value => update("auditArea", value)} disabled={areas.isLoading || !!areas.error}><SelectTrigger><SelectValue placeholder="Select Audit Area"/></SelectTrigger><SelectContent>{areas.options.map(area => <SelectItem key={area.value} value={area.value}>{area.label}</SelectItem>)}</SelectContent></Select>{areas.error && <p className="mt-1 text-sm text-destructive">Unable to load Audit Area master data. <button type="button" className="underline" onClick={() => areas.refetch()}>Retry</button></p>}{!areas.isLoading && !areas.error && !areas.options.length && <p className="mt-1 text-sm text-muted-foreground">No active Audit Area values are configured in master data.</p>}</div>
          <div><Label htmlFor="checklist-question">Audit Question *</Label><Input id="checklist-question" value={draft.question} onChange={event => update("question", event.target.value)} placeholder="Enter the audit question"/></div>
          <div><Label htmlFor="checklist-description">Description</Label><Textarea id="checklist-description" rows={4} value={draft.description} onChange={event => update("description", event.target.value)} placeholder="Description or findings"/></div>
          <div><Label>Audit Findings</Label><Select value={draft.auditFinding} onValueChange={value => update("auditFinding", value)}><SelectTrigger><SelectValue placeholder="Select a finding (optional)"/></SelectTrigger><SelectContent>{findings.map(value => <SelectItem key={value} value={value}>{value}</SelectItem>)}</SelectContent></Select>{draft.auditFinding && <button type="button" className="mt-1 text-xs text-muted-foreground underline" onClick={() => update("auditFinding", "")}>Clear selection</button>}</div>
          <div><Label htmlFor="checklist-evidence">Evidence (optional — attach to this item)</Label>{draft.evidenceIds.map(id => <div key={id} className="flex items-center justify-between gap-2 text-sm"><span>{filesById.get(id)?.fileName ?? "Attached file"}</span><button type="button" className="text-destructive underline" onClick={() => update("evidenceIds", draft.evidenceIds.filter(value => value !== id))}>Remove from item</button></div>)}<Input id="checklist-evidence" type="file" accept="image/*,.xlsx,.xls,.doc,.docx,.pdf,.ppt,.pptx" onChange={event => { update("file", event.target.files?.[0] ?? null); setUploadedId(null); uploadReference.current = crypto.randomUUID(); }}/><p className="mt-1 text-xs text-muted-foreground">The selected file, including an Excel file, will be stored as evidence when you save this item. To import Checklist rows instead, use Upload Excel above.</p>{draft.file && <p className="mt-1 text-sm">{draft.file.name}</p>}</div>
        </div>
        <DialogFooter><Button variant="outline" disabled={saving} onClick={reset}>Cancel</Button><Button disabled={saving || areas.isLoading || !!areas.error} onClick={save}>{saving ? "Saving…" : editing ? "Save Changes" : "Save"}</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  </Card>;
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
    <TabsContent value="overview"><Card><CardHeader><CardTitle>Audit overview</CardTitle></CardHeader><CardContent className="grid gap-4 sm:grid-cols-3"><div><Label>Status</Label><div><Badge>{audit.status}</Badge></div></div><div><Label>Project</Label><p>{audit.projectId}</p></div><div><Label>Plan</Label><p>{audit.planId}</p></div><div><Label>Started</Label><p>{date(audit.startedAt)}</p></div><div><Label>Closed</Label><p>{date(audit.closedAt)}</p></div><div><Label>Checklist</Label><p>{audit.checklist?.length??0} items</p></div></CardContent></Card></TabsContent>
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

function CarActionDetail() {
  const { id = "" } = useParams<{ id: string }>();
  const query = useGetCorrectiveActionReport(id);
  const qc = useQueryClient();
  const { toast } = useToast();
  const [editing, setEditing] = useState(false);
  const submit = useSubmitCorrectiveActionReport();
  const review = useReviewCorrectiveActionReport();
  const refresh = (message: string) => {
    void qc.invalidateQueries({ queryKey: ["/api/audit/cars"] });
    void qc.invalidateQueries({ queryKey: getGetCorrectiveActionReportQueryKey(id) });
    void qc.invalidateQueries({ queryKey: ["/api/audit/my-actions"] });
    toast({ title: message });
  };
  const failure = (error: unknown) => toast({ title: "Unable to update CAR", description: errorText(error), variant: "destructive" });
  const car = query.data;
  return <div className="space-y-5">
    <Button variant="ghost" asChild><Link href="/audit/my-actions"><ArrowLeft className="mr-2 size-4"/>For my Action</Link></Button>
    <PageHeader title="Corrective action" description="Complete or review this assigned corrective action."/>
    <State loading={query.isLoading} error={query.error} empty={!car} label="Corrective action not found."/>
    {car && <Card><CardContent className="space-y-5 pt-6">
      <div><div className="flex flex-wrap gap-2"><Badge variant={workflowTone(car.status)}>{car.status}</Badge>{car.extensionStatus && <Badge variant="outline">Extension {car.extensionStatus}</Badge>}</div>
        <h2 className="mt-3 text-lg font-semibold">{car.responsibleDepartment}</h2>
        <p className="text-sm text-muted-foreground">Due {date(car.dueDate)}</p></div>
      <div className="grid gap-4 text-sm md:grid-cols-3">
        <div><p className="font-medium">Root cause</p><p className="whitespace-pre-wrap">{car.rootCause || "Not provided"}</p></div>
        <div><p className="font-medium">Correction</p><p className="whitespace-pre-wrap">{car.correction || "Not provided"}</p></div>
        <div><p className="font-medium">Corrective action</p><p className="whitespace-pre-wrap">{car.correctiveAction || "Not provided"}</p></div>
      </div>
      <div className="flex flex-wrap gap-2">
        {["Open", "Draft", "Rejected"].includes(car.status) && <>
          <Button variant="outline" onClick={() => setEditing(true)}>Edit response</Button>
          <Button disabled={submit.isPending} onClick={() => submit.mutate({ id: car.id }, { onSuccess: () => refresh("CAR submitted"), onError: failure })}>Submit</Button>
        </>}
        {car.status === "Submitted" && <>
          <Button disabled={review.isPending} onClick={() => review.mutate({ id: car.id, data: { decision: "accept" } }, { onSuccess: () => refresh("CAR accepted"), onError: failure })}>Accept</Button>
          <Button variant="outline" disabled={review.isPending} onClick={() => { const comments = window.prompt("Rejection remarks (required)"); if (comments?.trim()) review.mutate({ id: car.id, data: { decision: "reject", comments: comments.trim() } }, { onSuccess: () => refresh("CAR rejected"), onError: failure }); }}>Reject</Button>
        </>}
      </div>
    </CardContent></Card>}
    <Dialog open={editing} onOpenChange={setEditing}><DialogContent><DialogHeader><DialogTitle>CAR response</DialogTitle></DialogHeader>{car && <CarEditor car={car} onClose={() => { setEditing(false); refresh("CAR updated"); }}/>}</DialogContent></Dialog>
  </div>;
}

const reportCards=[["Open vs closed audits","open-vs-closed"],["Findings log","findings-log"],["Audit ageing","ageing"],["CAR status & closure","car-status"],["Annual audit schedule","schedule"]];
function Reports() {
  return <div className="space-y-5"><PageHeader title="Report centre" description="Operational audit reports and export files"/><div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">{reportCards.map(([title,path])=><Card key={path}><CardHeader><div className="mb-2 w-fit rounded-lg bg-accent p-2 text-accent-foreground"><BarChart3 className="size-5"/></div><CardTitle className="text-base">{title}</CardTitle><CardDescription>Current live audit workspace data</CardDescription></CardHeader><CardContent><Button variant="outline" className="w-full" asChild><a href={`/api/audit/reports/${path}?format=csv`} download><Download className="mr-2 size-4"/>Download CSV</a></Button></CardContent></Card>)}</div></div>;
}

function AuditReport() {
  const {id=""}=useParams<{id:string}>();const query=useGetGeneratedAuditReport(id);
  const attendeeOptions = useListAuditMeetingAttendees(id);
  if(query.isLoading||query.error||!query.data)return <State loading={query.isLoading} error={query.error} empty={!query.data}/>;
  const r=query.data;
  return <div className="space-y-5 print:p-0"><div className="flex justify-between print:hidden"><Button variant="ghost" asChild><Link href={`/audit/audits/${id}`}><ArrowLeft className="mr-2 size-4"/>Workspace</Link></Button><div className="flex gap-2"><Button variant="outline" asChild><a href={`/api/audit/audits/${id}/report?format=csv`} download><Download className="mr-2 size-4"/>CSV</a></Button><Button onClick={()=>window.print()}><Printer className="mr-2 size-4"/>Print</Button></div></div><Card><CardHeader className="border-b bg-primary text-primary-foreground"><CardTitle className="text-2xl">Audit Report</CardTitle><CardDescription className="text-primary-foreground/80">Generated {new Date(r.generatedAt).toLocaleString()}</CardDescription></CardHeader><CardContent className="space-y-8 pt-6"><section><h2 className="text-xl font-semibold">{r.audit.title}</h2><div className="mt-3 grid gap-2 text-sm sm:grid-cols-3"><p><b>Status:</b> {r.audit.status}</p><p><b>Project:</b> {r.audit.projectId}</p><p><b>Started:</b> {date(r.audit.startedAt)}</p></div></section>
    <section className="grid gap-4 md:grid-cols-2">{[["Opening meeting",r.audit.openingMeeting],["Closing meeting",r.audit.closingMeeting]].map(([name,m])=>{const meeting=m as MeetingMinutes|undefined;return <div key={name as string} className="rounded-lg border p-4"><h3 className="font-semibold">{name as string}</h3>{meeting?<><p className="mt-1 text-sm">{date(meeting.heldAt)} · {meeting.attendees.map(id => meetingAttendeeLabel(id, attendeeOptions.data ?? [])).join(", ")}</p><p className="mt-2 whitespace-pre-wrap text-sm text-muted-foreground">{meeting.minutes}</p></>:<p className="mt-2 text-sm text-muted-foreground">Not recorded.</p>}</div>})}</section>
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
    <Route path="/audit/my-actions" component={MyActions}/>
    <Route path="/audit/schedules/:parentId" component={Schedules}/>
    <Route path="/audit/schedules" component={Programmes}/>
    <Route path="/audit/plans/:id" component={PlanDetail}/>
    <Route path="/audit/plans" component={Plans}/>
    <Route path="/audit/audits/:id/report" component={AuditReport}/>
    <Route path="/audit/audits/:id" component={AuditWorkspace}/>
    <Route path="/audit/audits" component={Audits}/>
    <Route path="/audit/cars/:id" component={CarActionDetail}/>
    <Route path="/audit/cars" component={Cars}/>
    <Route path="/audit/reports" component={Reports}/>
    <Route><Missing/></Route>
  </Switch></Layout>;
}