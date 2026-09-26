import { create } from 'zustand';
import { db } from '../utils/db';
import { uid } from '../utils/id';
import { buildExpiryList, dueSamples, expireDateOf, formatDate, isDisposed, todayStr } from '../utils/degree';
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
  /** 处置方式：转销毁 / 延期观察 / 复检放行 */
  method: DisposalMethod;
  /** 处置人 */
  operator: string;
  /** 处置时间 ISO，缺省为当前时间 */
  disposedAt?: string;
  /** 新留样期（月）：延期观察必填 */
  extendedMonths?: number;
  note?: string;
}

/** 柜位被占用时抛出，携带占用柜位上的留样编号 */
export class CabinetOccupiedError extends Error {
  constructor(
    readonly cabinet: string,
    readonly occupantNo: string,
  ) {
    super(`柜位 ${cabinet} 已被留样 ${occupantNo} 占用`);
    this.name = 'CabinetOccupiedError';
  }
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
  /** 到期处置登记（转销毁 / 延期观察 / 复检放行） */
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
    // 每个柜位只放一份留样：已终结处置（销毁/放行）的留样已离开柜位，不占柜位
    const occupant = get().samples.find((s) => s.cabinet === input.cabinet && !isDisposed(s));
    if (occupant) {
      throw new CabinetOccupiedError(input.cabinet, occupant.sampleNo);
    }
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
    if (isDisposed(current)) {
      // 转销毁 / 复检放行后留样已离柜，不允许重复登记
      return;
    }
    const isExtension = input.method === '延期观察';
    const extendedMonths = isExtension ? Number(input.extendedMonths) : 0;
    if (isExtension && !extendedMonths) {
      throw new Error('延期观察必须填写新留样期');
    }
    // 延期观察：原到期日（重算前生效的到期日）留档，新到期日从延期当天重算
    const record: DisposalRecord = {
      id: uid('disposal'),
      method: input.method,
      operator: input.operator.trim(),
      disposedAt: input.disposedAt ?? new Date().toISOString(),
      extendedMonths: isExtension ? extendedMonths : undefined,
      originalExpireAt: isExtension ? formatDate(expireDateOf(current)) : undefined,
      note: input.note?.trim() || undefined,
    };
    const next: RetainSample = { ...current, disposals: [...(current.disposals ?? []), record] };
    await db.samples.put(next);
    set({ samples: get().samples.map((s) => (s.id === sampleId ? next : s)) });
  },

  expiryList: (warnDays = 30) => buildExpiryList(get().samples, warnDays),

  dueList: (warnDays = 30) => dueSamples(get().samples, warnDays),

  usedCabinets: () => Array.from(new Set(get().samples.filter((s) => !isDisposed(s)).map((s) => s.cabinet))),
}));
