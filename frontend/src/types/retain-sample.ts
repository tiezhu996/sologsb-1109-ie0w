/** 单次留样观察记录 */
export interface ObserveLog {
  id: string;
  /** 观察日期 YYYY-MM-DD */
  date: string;
  /** 色泽 */
  color: string;
  /** 气味 */
  odor: string;
  /** 霉变情况 */
  mold: string;
  /** 观察人 */
  observer: string;
  /** 备注 */
  note?: string;
}

/** 留样处置方式 */
export type DisposalMethod = '转销毁' | '延期观察' | '复检放行';

/** 处置方式选项（登记下拉用） */
export const DISPOSAL_METHODS: DisposalMethod[] = ['转销毁', '延期观察', '复检放行'];

/** 留样处置登记 */
export interface DisposalRecord {
  id: string;
  /** 处置方式 */
  method: DisposalMethod;
  /** 处置人 */
  operator: string;
  /** 处置时间 ISO */
  disposedAt: string;
  /** 新留样期（月）：仅「延期观察」填写 */
  extendedMonths?: number;
  /** 延期前生效的到期日留档 YYYY-MM-DD：仅「延期观察」填写 */
  originalExpireAt?: string;
  /** 备注 */
  note?: string;
}

/** 留样 */
export interface RetainSample {
  id: string;
  /** 留样编号 */
  sampleNo: string;
  /** 关联炮制批次 */
  batchId: string;
  /** 留样量（g） */
  amountG: number;
  /** 留样期（月） */
  retainMonths: number;
  /** 柜位 */
  cabinet: string;
  /** 留样日期 ISO */
  retainedAt: string;
  /** 观察记录，按日期追加 */
  observeLogs: ObserveLog[];
  /**
   * 处置登记，按时间追加（升级前的老留样缺该字段，按 undefined 处理）。
   * 转销毁 / 复检放行后留样撤下到期提醒并释放柜位；
   * 延期观察后从处置当天按新留样期重算到期日，原到期日留档。
   */
  disposals?: DisposalRecord[];
}

/** 留样柜位（A/B/C 三柜，每柜 12 位） */
export const CABINETS: string[] = ['A', 'B', 'C'].flatMap((c) =>
  Array.from({ length: 12 }, (_, i) => `${c}-${String(i + 1).padStart(2, '0')}`),
);

/** 留样到期派生态 */
export type SampleExpiryState = '已到期' | '临期' | '观察中' | '已处置';

/** 留样到期派生信息 */
export interface SampleExpiry {
  sample: RetainSample;
  /** 当前生效到期日 YYYY-MM-DD（延期观察后为重算日期） */
  expireAt: string;
  /** 距到期剩余天数（负数表示已过期） */
  daysLeft: number;
  state: SampleExpiryState;
  /** 最近一次处置登记（没有则为 undefined，老留样兼容） */
  disposal?: DisposalRecord;
}
