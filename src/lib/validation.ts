import { z } from 'zod';

export const appointmentFormSchema = z.object({
  studentName: z
    .string()
    .trim()
    .min(2, { message: '이름을 2글자 이상 정확히 입력해주세요.' })
    .max(20, { message: '이름은 최대 20자까지 가능합니다.' }),
  studentId: z
    .string()
    .trim()
    .regex(/^[0-9A-Za-z]{4,15}$/, {
      message: '학번은 4~15자의 숫자 또는 영문 조합이어야 합니다.',
    }),
  phone: z
    .string()
    .trim()
    .regex(/^(01[016789]-?[0-9]{3,4}-?[0-9]{4}|0[2-8][0-9]?-?[0-9]{3,4}-?[0-9]{4})$/, {
      message: '올바른 한국 전화번호 형식(예: 010-1234-5678)으로 입력해주세요.',
    }),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, { message: '날짜 형식이 잘못되었습니다.' }),
  startTime: z.string().regex(/^\d{2}:\d{2}$/, { message: '시간 형식이 잘못되었습니다.' }),
  consultationType: z.enum(['in_person', 'online']).default('in_person'),
});

export type AppointmentFormData = z.infer<typeof appointmentFormSchema>;

export const classScheduleSchema = z.object({
  title: z.string().trim().min(1, '과목명을 입력해주세요.'),
  weekday: z.enum(['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday']),
  startTime: z.string().regex(/^\d{2}:\d{2}$/, '시작시간 형식 오류'),
  endTime: z.string().regex(/^\d{2}:\d{2}$/, '종료시간 형식 오류'),
  startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, '시작일 형식 오류'),
  endDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, '종료일 형식 오류'),
});

export const personalScheduleSchema = z.object({
  title: z.string().trim().min(1, '일정 제목을 입력해주세요.'),
  note: z.string().optional(),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, '날짜 형식 오류'),
  startTime: z.string().regex(/^\d{2}:\d{2}$/, '시작시간 형식 오류'),
  endTime: z.string().regex(/^\d{2}:\d{2}$/, '종료시간 형식 오류'),
});

export const semesterSettingsSchema = z.object({
  year: z.number().int().min(2020).max(2050),
  semester: z.union([z.literal(1), z.literal(2)]),
  startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, '시작일 형식 오류'),
  endDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, '종료일 형식 오류'),
  dayStart: z.string().default('09:00'),
  dayEnd: z.string().default('18:00'),
  active: z.boolean().default(true),
});
