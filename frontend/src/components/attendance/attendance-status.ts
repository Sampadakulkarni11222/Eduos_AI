import type { AttStatus } from '@/lib/types';

export interface DayInfo {
  status?: AttStatus;
  isHoliday: boolean;
  isNonSchoolDay: boolean;
  subjects: string[];
}

export interface DayStyle {
  bg: string;
  text: string;
  label: string;
}

/** Green=Present, Red=Absent, Yellow=Leave, Gray=Holiday/non-school/no-record. */
export function dayStyle(info: DayInfo | undefined, isFuture: boolean): DayStyle {
  if (isFuture) return { bg: 'transparent', text: 'var(--text-faint)', label: '' };
  if (info?.isHoliday) return { bg: '#ECE7DB', text: '#7A7264', label: 'Holiday' };

  switch (info?.status) {
    case 'PRESENT':
      return { bg: '#E3EFE6', text: 'var(--green)', label: 'Present' };
    case 'LATE':
      return { bg: '#E3EFE6', text: 'var(--green)', label: 'Present (Late)' };
    case 'ABSENT':
      return { bg: '#F6E1DF', text: 'var(--red)', label: 'Absent' };
    case 'EXCUSED':
      return { bg: '#F7ECD4', text: 'var(--amber)', label: 'Leave' };
    case 'HALF_DAY':
      return { bg: '#F7ECD4', text: 'var(--amber)', label: 'Half Day' };
    default:
      break;
  }

  if (info?.isNonSchoolDay) return { bg: '#F4F1E8', text: 'var(--text-faint)', label: 'Non-school day' };
  return { bg: 'transparent', text: 'var(--text-faint)', label: 'No record' };
}

export const ATTENDANCE_LEGEND = [
  { label: 'Present', bg: '#E3EFE6', text: 'var(--green)' },
  { label: 'Absent', bg: '#F6E1DF', text: 'var(--red)' },
  { label: 'Leave', bg: '#F7ECD4', text: 'var(--amber)' },
  { label: 'Holiday', bg: '#ECE7DB', text: '#7A7264' },
];
