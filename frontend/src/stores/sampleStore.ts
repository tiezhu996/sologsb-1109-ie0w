import { create } from 'zustand';
import { db } from '../utils/db';
import { uid } from '../utils/id';
import { buildExpiryList, dueSamples, expireDateOf, formatDate, isSampleClosed, todayStr } from '../utils/degree';
import type { DisposalMethod, DisposalRecord, ObserveLog, RetainSample, SampleExpiry } from '../types/retain-sample';

export interface SampleInput {
  sampleNo: string;
  batchId: string;
  amountG: number;
  retainMonths: number;
  cabinet: string;
  retainedAt?: string;
}

export interface ObserveInput {
  date: string;
  color: string;
  odor: string;
  mold: string;
  observer: string;
  note?: string;
}

export interface DisposalInput {
  method: DisposalMethod;
  operator: string;
  disposedAt: string;
  /** 延期观察：新留样期（月） */
  extendMonths?: number;
  note?: string;
}

interface SampleState {
  samples: RetainSample[];
  hydrated: boolean;
  hydrate: () => Promise<void>;
  createSample: (input: SampleInput) => Promise<RetainSample>;
  updateSample: (id: string, patch: Partial<SampleInput>) => Promise<void>;
  removeSample: (id: string) => Promise<void>;
  /** 观察记录按日期追加 */
  appendObserveLog: (sampleId: string, input: ObserveInput) => Promise<void>;
  /** 到期处置登记：转销毁/复检放行结案并释放柜位，延期观察重算到期日 */
  disposeSample: (sampleId: string, input: DisposalInput) => Promise<void>;
  /** 到期派生清单（按剩余天数升序） */
  expiryList: (warnDays?: number) => SampleExpiry[];
  /** 到期前 30 天提醒清单 */
  dueList: (warnDays?: number) => SampleExpiry[];
  usedCabinets: () => string[];
}

export const useSampleStore = create<SampleState>()((set, get) => ({
  samples: [],
  hydrated: false,

  hydrate: async () => {
    const samples = await db.samples.toArray();
    set({ samples, hydrated: true });
  },

  createSample: async (input) => {
    const sample: RetainSample = {
      id: uid('sample'),
      sampleNo: input.sampleNo.trim(),
      batchId: input.batchId,
      amountG: Number(input.amountG) || 0,
      retainMonths: Number(input.retainMonths) || 6,
      cabinet: input.cabinet,
      retainedAt: input.retainedAt ?? new Date().toISOString(),
      observeLogs: [],
    };
    await db.samples.put(sample);
    set({ samples: [...get().samples, sample] });
    return sample;
  },

  updateSample: async (id, patch) => {
    const current = get().samples.find((s) => s.id === id);
    if (!current) {
      return;
    }
    const next: RetainSample = { ...current, ...patch };
    await db.samples.put(next);
    set({ samples: get().samples.map((s) => (s.id === id ? next : s)) });
  },

  removeSample: async (id) => {
    await db.samples.delete(id);
    set({ samples: get().samples.filter((s) => s.id !== id) });
  },

  appendObserveLog: async (sampleId, input) => {
    const current = get().samples.find((s) => s.id === sampleId);
    if (!current) {
      return;
    }
    const log: ObserveLog = {
      id: uid('log'),
      date: input.date || todayStr(),
      color: input.color,
      odor: input.odor,
      mold: input.mold,
      observer: input.observer,
      note: input.note?.trim() || undefined,
    };
    const logs = [...(current.observeLogs ?? []), log].sort((a, b) => a.date.localeCompare(b.date));
    const next: RetainSample = { ...current, observeLogs: logs };
    await db.samples.put(next);
    set({ samples: get().samples.map((s) => (s.id === sampleId ? next : s)) });
  },

  disposeSample: async (sampleId, input) => {
    const current = get().samples.find((s) => s.id === sampleId);
    if (!current) {
      return;
    }
    const disposal: DisposalRecord = {
      id: uid('disposal'),
      method: input.method,
      operator: input.operator.trim(),
      disposedAt: input.disposedAt || new Date().toISOString(),
      note: input.note?.trim() || undefined,
    };
    if (input.method === '延期观察') {
      disposal.extendMonths = Number(input.extendMonths) || 6;
      // 原到期日留档：按登记延期前的口径计算
      disposal.originalExpireAt = formatDate(expireDateOf(current));
    }
    const next: RetainSample = { ...current, disposals: [...(current.disposals ?? []), disposal] };
    await db.samples.put(next);
    set({ samples: get().samples.map((s) => (s.id === sampleId ? next : s)) });
  },

  expiryList: (warnDays = 30) => buildExpiryList(get().samples, warnDays),

  dueList: (warnDays = 30) => dueSamples(get().samples, warnDays),

  usedCabinets: () => Array.from(new Set(get().samples.filter((s) => !isSampleClosed(s)).map((s) => s.cabinet))),
}));
