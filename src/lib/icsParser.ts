/**
 * iCalendar (.ics) Parser for Google Calendar exports
 * Specifically tailored for extracting events within the active semester period
 * and converting them to Professor Personal Schedules (개인 일정).
 */

export interface ParsedIcsEvent {
  uid: string;
  title: string;
  description?: string;
  location?: string;
  date: string; // "YYYY-MM-DD"
  startTime: string; // "HH:mm"
  endTime: string; // "HH:mm"
  isAllDay: boolean;
  isRecurring: boolean;
  status: 'CONFIRMED' | 'TENTATIVE' | 'CANCELLED';
  rawStart: string;
  rawEnd: string;
}

export interface IcsParseResult {
  calendarName?: string;
  totalEventsInFile: number;
  inSemesterEvents: ParsedIcsEvent[];
  outOfSemesterCount: number;
  cancelledCount: number;
  duplicateCount: number;
}

/**
 * Unfolds folded lines per RFC 5545 Section 3.1
 * Lines starting with space or tab are continuation lines.
 */
function unfoldLines(icsContent: string): string[] {
  // Replace CRLF or LF followed by a space or tab
  const unfolded = icsContent.replace(/\r\n[ \t]|\r[ \t]|\n[ \t]/g, '');
  return unfolded.split(/\r\n|\r|\n/);
}

/**
 * Unescapes RFC 5545 escaped characters (\,, \;, \\, \n, \N)
 */
function unescapeIcsText(str: string): string {
  if (!str) return '';
  return str
    .replace(/\\n/gi, '\n')
    .replace(/\\,/g, ',')
    .replace(/\\;/g, ';')
    .replace(/\\\\/g, '\\')
    .trim();
}

/**
 * Formats a Date object in Asia/Seoul (KST, UTC+9) to "YYYY-MM-DD" and "HH:mm"
 */
function formatDateToKst(date: Date): { dateStr: string; timeStr: string } {
  // Format explicitly using Asia/Seoul timezone
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Seoul',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
    hourCycle: 'h23',
  });

  const parts = formatter.formatToParts(date);
  const partMap: Record<string, string> = {};
  for (const p of parts) {
    partMap[p.type] = p.value;
  }

  const dateStr = `${partMap.year}-${partMap.month}-${partMap.day}`;
  let hour = partMap.hour || '00';
  if (hour === '24') hour = '00';
  const timeStr = `${hour}:${partMap.minute || '00'}`;
  return { dateStr, timeStr };
}

/**
 * Parses an iCalendar date or datetime string into dateStr ("YYYY-MM-DD") and timeStr ("HH:mm")
 */
function parseIcsDateTime(
  value: string,
  params: Record<string, string>,
  calTimeZone = 'Asia/Seoul'
): { dateStr: string; timeStr: string; isAllDay: boolean; dateObj: Date } {
  const cleanVal = value.trim();
  const isDateOnly = params['VALUE'] === 'DATE' || /^\d{8}$/.test(cleanVal);

  if (isDateOnly) {
    const y = parseInt(cleanVal.slice(0, 4), 10);
    const m = parseInt(cleanVal.slice(4, 6), 10) - 1;
    const d = parseInt(cleanVal.slice(6, 8), 10);
    const dateObj = new Date(Date.UTC(y, m, d, 0, 0, 0));
    const pad = (n: number) => (n < 10 ? `0${n}` : `${n}`);
    return {
      dateStr: `${y}-${pad(m + 1)}-${pad(d)}`,
      timeStr: '09:00', // Default consultation start
      isAllDay: true,
      dateObj,
    };
  }

  // Datetime format: YYYYMMDDTHHmmss or YYYYMMDDTHHmmssZ
  const match = cleanVal.match(/^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})(Z)?/);
  if (!match) {
    // Fallback: simple date parsing
    const parsed = new Date(cleanVal);
    if (!isNaN(parsed.getTime())) {
      const { dateStr, timeStr } = formatDateToKst(parsed);
      return { dateStr, timeStr, isAllDay: false, dateObj: parsed };
    }
    const today = new Date();
    const { dateStr, timeStr } = formatDateToKst(today);
    return { dateStr, timeStr, isAllDay: false, dateObj: today };
  }

  const y = parseInt(match[1], 10);
  const mon = parseInt(match[2], 10) - 1;
  const d = parseInt(match[3], 10);
  const h = parseInt(match[4], 10);
  const min = parseInt(match[5], 10);
  const sec = parseInt(match[6], 10);
  const isUtc = Boolean(match[7]);

  let dateObj: Date;
  if (isUtc) {
    // UTC date
    dateObj = new Date(Date.UTC(y, mon, d, h, min, sec));
    const { dateStr, timeStr } = formatDateToKst(dateObj);
    return { dateStr, timeStr, isAllDay: false, dateObj };
  } else {
    // Local / Floating datetime or specified TZID
    const tzid = params['TZID'] || calTimeZone;
    if (tzid.includes('Seoul') || tzid.includes('KST') || !tzid) {
      // Treat directly as KST
      const pad = (n: number) => (n < 10 ? `0${n}` : `${n}`);
      const dateStr = `${y}-${pad(mon + 1)}-${pad(d)}`;
      const timeStr = `${pad(h)}:${pad(min)}`;
      // UTC timestamp for KST is UTC - 9 hours
      dateObj = new Date(Date.UTC(y, mon, d, h - 9, min, sec));
      return { dateStr, timeStr, isAllDay: false, dateObj };
    } else {
      // Other timezone: best effort local interpretation
      const pad = (n: number) => (n < 10 ? `0${n}` : `${n}`);
      const dateStr = `${y}-${pad(mon + 1)}-${pad(d)}`;
      const timeStr = `${pad(h)}:${pad(min)}`;
      dateObj = new Date(y, mon, d, h, min, sec);
      return { dateStr, timeStr, isAllDay: false, dateObj };
    }
  }
}

/**
 * Rounds a time span [startTime, endTime] to 30-minute intervals
 * e.g., 14:15 ~ 15:10 => 14:00 ~ 15:30 (broad coverage to protect slots)
 */
export function alignTimeTo30MinSlots(
  startTimeStr: string,
  endTimeStr: string,
  dayStart = '09:00',
  dayEnd = '18:00'
): { startTime: string; endTime: string } {
  const [sh, sm] = startTimeStr.split(':').map(Number);
  const [eh, em] = endTimeStr.split(':').map(Number);

  const startMinutes = sh * 60 + sm;
  const endMinutes = eh * 60 + em;

  // Round start DOWN to nearest 30m
  const floor30 = Math.floor(startMinutes / 30) * 30;
  // Round end UP to nearest 30m
  const ceil30 = Math.ceil(endMinutes / 30) * 30;

  const pad = (n: number) => (n < 10 ? `0${n}` : `${n}`);
  const formatMin = (m: number) => `${pad(Math.floor(m / 60))}:${pad(m % 60)}`;

  let finalStart = formatMin(floor30);
  let finalEnd = formatMin(Math.max(floor30 + 30, ceil30));

  // If outside day bounds or inverted, clamp safely
  if (finalEnd <= finalStart) {
    const endM = Math.min(23 * 60 + 30, floor30 + 60);
    finalEnd = formatMin(endM);
  }

  return { startTime: finalStart, endTime: finalEnd };
}

/**
 * Main parser: takes .ics text content and semester date range,
 * returns parsed events within the semester.
 */
export function parseGoogleCalendarIcs(
  icsText: string,
  semester: {
    startDate: string; // "YYYY-MM-DD"
    endDate: string; // "YYYY-MM-DD"
    dayStart?: string;
    dayEnd?: string;
  }
): IcsParseResult {
  const lines = unfoldLines(icsText);
  let calName = '';
  let calTimeZone = 'Asia/Seoul';

  const rawEvents: Array<{
    props: Record<string, { value: string; params: Record<string, string> }[]>;
  }> = [];

  let currentEventProps: Record<string, { value: string; params: Record<string, string> }[]> | null = null;

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;

    if (trimmed.startsWith('X-WR-CALNAME:')) {
      calName = unescapeIcsText(trimmed.substring('X-WR-CALNAME:'.length));
      continue;
    }
    if (trimmed.startsWith('X-WR-TIMEZONE:')) {
      calTimeZone = trimmed.substring('X-WR-TIMEZONE:'.length).trim() || 'Asia/Seoul';
      continue;
    }

    if (trimmed === 'BEGIN:VEVENT') {
      currentEventProps = {};
      continue;
    }

    if (trimmed === 'END:VEVENT') {
      if (currentEventProps) {
        rawEvents.push({ props: currentEventProps });
        currentEventProps = null;
      }
      continue;
    }

    if (currentEventProps) {
      const colonIdx = trimmed.indexOf(':');
      if (colonIdx === -1) continue;

      const propPart = trimmed.substring(0, colonIdx);
      const valPart = trimmed.substring(colonIdx + 1);

      const [propName, ...paramStrs] = propPart.split(';');
      const upperPropName = propName.toUpperCase().trim();

      const params: Record<string, string> = {};
      for (const p of paramStrs) {
        const [k, v] = p.split('=');
        if (k && v) {
          params[k.toUpperCase().trim()] = v.replace(/^"|"$/g, '').trim();
        }
      }

      if (!currentEventProps[upperPropName]) {
        currentEventProps[upperPropName] = [];
      }
      currentEventProps[upperPropName].push({ value: valPart, params });
    }
  }

  const semesterStart = semester.startDate; // "2026-09-01"
  const semesterEnd = semester.endDate; // "2026-12-31"
  const defaultDayStart = semester.dayStart || '09:00';
  const defaultDayEnd = semester.dayEnd || '18:00';

  const inSemesterEvents: ParsedIcsEvent[] = [];
  let outOfSemesterCount = 0;
  let cancelledCount = 0;

  for (const item of rawEvents) {
    const props = item.props;
    const summaryProp = props['SUMMARY']?.[0];
    const dtstartProp = props['DTSTART']?.[0];
    const dtendProp = props['DTEND']?.[0];
    const descProp = props['DESCRIPTION']?.[0];
    const locProp = props['LOCATION']?.[0];
    const statusProp = props['STATUS']?.[0]?.value?.toUpperCase().trim();
    const uid = props['UID']?.[0]?.value || Math.random().toString(36).substring(2);
    const rruleProp = props['RRULE']?.[0];

    // Skip canceled events
    if (statusProp === 'CANCELLED') {
      cancelledCount++;
      continue;
    }

    if (!dtstartProp) continue;

    const title = unescapeIcsText(summaryProp?.value || '제목 없는 일정');
    const description = unescapeIcsText(descProp?.value || '');
    const location = unescapeIcsText(locProp?.value || '');

    const parsedStart = parseIcsDateTime(dtstartProp.value, dtstartProp.params, calTimeZone);
    let parsedEnd = dtendProp
      ? parseIcsDateTime(dtendProp.value, dtendProp.params, calTimeZone)
      : null;

    if (parsedStart.isAllDay) {
      // All day event: set to consultation start & end
      parsedStart.timeStr = defaultDayStart;
      if (!parsedEnd) {
        parsedEnd = {
          dateStr: parsedStart.dateStr,
          timeStr: defaultDayEnd,
          isAllDay: true,
          dateObj: parsedStart.dateObj,
        };
      } else {
        parsedEnd.timeStr = defaultDayEnd;
      }
    } else if (!parsedEnd) {
      // Default duration: 1 hour
      const [h, m] = parsedStart.timeStr.split(':').map(Number);
      const endM = h * 60 + m + 60;
      const pad = (n: number) => (n < 10 ? `0${n}` : `${n}`);
      const endTimeStr = `${pad(Math.min(23, Math.floor(endM / 60)))}:${pad(endM % 60)}`;
      parsedEnd = {
        dateStr: parsedStart.dateStr,
        timeStr: endTimeStr,
        isAllDay: false,
        dateObj: new Date(parsedStart.dateObj.getTime() + 60 * 60 * 1000),
      };
    }

    // Align times to 30-min boundaries
    const aligned = alignTimeTo30MinSlots(
      parsedStart.timeStr,
      parsedEnd.timeStr,
      defaultDayStart,
      defaultDayEnd
    );

    // Check single occurrence
    const eventDate = parsedStart.dateStr;

    // Handle RRULE (Weekly recurring expansion within semester)
    if (rruleProp?.value) {
      const rruleVal = rruleProp.value;
      const isWeekly = rruleVal.includes('FREQ=WEEKLY');

      if (isWeekly) {
        // Expand weekly until semester end or RRULE UNTIL
        let untilDateStr = semesterEnd;
        const untilMatch = rruleVal.match(/UNTIL=(\d{8})/);
        if (untilMatch) {
          const uy = untilMatch[1].slice(0, 4);
          const um = untilMatch[1].slice(4, 6);
          const ud = untilMatch[1].slice(6, 8);
          const rruleUntil = `${uy}-${um}-${ud}`;
          if (rruleUntil < untilDateStr) untilDateStr = rruleUntil;
        }

        // Generate weekly dates from parsedStart.dateObj
        const curr = new Date(parsedStart.dateObj);
        let safetyCount = 0;

        while (safetyCount < 40) {
          safetyCount++;
          const { dateStr } = formatDateToKst(curr);
          if (dateStr > untilDateStr) break;

          if (dateStr >= semesterStart && dateStr <= semesterEnd) {
            inSemesterEvents.push({
              uid: `${uid}_${dateStr}`,
              title,
              description: description || (location ? `장소: ${location}` : undefined),
              location: location || undefined,
              date: dateStr,
              startTime: aligned.startTime,
              endTime: aligned.endTime,
              isAllDay: parsedStart.isAllDay,
              isRecurring: true,
              status: (statusProp as any) || 'CONFIRMED',
              rawStart: dtstartProp.value,
              rawEnd: dtendProp?.value || '',
            });
          } else {
            outOfSemesterCount++;
          }

          // Advance 7 days
          curr.setDate(curr.getDate() + 7);
        }
        continue;
      }
    }

    // Single event check
    if (eventDate >= semesterStart && eventDate <= semesterEnd) {
      inSemesterEvents.push({
        uid,
        title,
        description: description || (location ? `장소: ${location}` : undefined),
        location: location || undefined,
        date: eventDate,
        startTime: aligned.startTime,
        endTime: aligned.endTime,
        isAllDay: parsedStart.isAllDay,
        isRecurring: false,
        status: (statusProp as any) || 'CONFIRMED',
        rawStart: dtstartProp.value,
        rawEnd: dtendProp?.value || '',
      });
    } else {
      outOfSemesterCount++;
    }
  }

  // Sort events chronologically by date and start time
  inSemesterEvents.sort((a, b) => {
    if (a.date !== b.date) return a.date.localeCompare(b.date);
    return a.startTime.localeCompare(b.startTime);
  });

  return {
    calendarName: calName || undefined,
    totalEventsInFile: rawEvents.length,
    inSemesterEvents,
    outOfSemesterCount,
    cancelledCount,
    duplicateCount: 0,
  };
}
