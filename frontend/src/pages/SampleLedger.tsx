import { useMemo, useState } from 'react';
import { App as AntApp, Button, Card, Col, DatePicker, Form, Input, InputNumber, Modal, Popconfirm, Row, Select, Space, Table, Tag, Typography } from 'antd';
import type { TableColumnsType } from 'antd';
import dayjs, { type Dayjs } from 'dayjs';
import StatBadge from '../components/common/StatBadge';
import CabinetGrid from '../components/common/CabinetGrid';
import EmptyPanel from '../components/common/EmptyPanel';
import { useSampleStore } from '../stores/sampleStore';
import { useBatchStore } from '../stores/batchStore';
import { useHerbStore } from '../stores/herbStore';
import { DISPOSAL_METHODS, CABINETS, type DisposalMethod, type DisposalRecord, type ObserveLog, type RetainSample, type SampleExpiry } from '../types/retain-sample';
import { buildExpiryList, expireDateOf, formatDate, isDisposed, todayStr } from '../utils/degree';

const { Title, Paragraph, Text } = Typography;

interface SampleFormValues {
  sampleNo: string;
  batchId: string;
  amountG: number;
  retainMonths: number;
  cabinet: string;
  retainedAt: Dayjs;
}

interface ObserveFormValues {
  date: Dayjs;
  color: string;
  odor: string;
  mold: string;
  observer: string;
  note?: string;
}

interface DisposalFormValues {
  method: DisposalMethod;
  operator: string;
  disposedAt: Dayjs;
  extendedMonths?: number;
  note?: string;
}

const STATE_COLOR: Record<SampleExpiry['state'], string> = { 已到期: 'red', 临期: 'orange', 观察中: 'green', 已处置: 'default' };

const MONTH_OPTIONS = [3, 6, 12, 18, 24, 36].map((m) => ({ label: `${m} 个月`, value: m }));

/** 留样与观察台账：一柜一份占用拦截、到期处置登记、按日期追加观察记录 */
export default function SampleLedger() {
  const { message } = AntApp.useApp();
  const samples = useSampleStore((s) => s.samples);
  const createSample = useSampleStore((s) => s.createSample);
  const removeSample = useSampleStore((s) => s.removeSample);
  const appendObserveLog = useSampleStore((s) => s.appendObserveLog);
  const disposeSample = useSampleStore((s) => s.disposeSample);
  const batches = useBatchStore((s) => s.batches);
  const herbs = useHerbStore((s) => s.herbs);

  const [selectedCabinet, setSelectedCabinet] = useState<string | undefined>(undefined);
  const [open, setOpen] = useState(false);
  const [form] = Form.useForm<SampleFormValues>();
  const [observeTarget, setObserveTarget] = useState<RetainSample | null>(null);
  const [observeForm] = Form.useForm<ObserveFormValues>();
  const [disposeTarget, setDisposeTarget] = useState<RetainSample | null>(null);
  const [disposeForm] = Form.useForm<DisposalFormValues>();

  // 延期观察表单联动：选了「延期观察」才填新留样期，并实时预览重算到期日
  const disposalMethod = Form.useWatch('method', disposeForm);
  const disposalAt = Form.useWatch('disposedAt', disposeForm);
  const extendedMonths = Form.useWatch('extendedMonths', disposeForm);

  const expiryList = useMemo(() => buildExpiryList(samples, 30), [samples]);
  const activeList = useMemo(() => expiryList.filter((item) => item.state !== '已处置'), [expiryList]);
  const dueList = useMemo(() => activeList.filter((item) => item.daysLeft <= 30), [activeList]);
  const expired = useMemo(() => activeList.filter((item) => item.daysLeft < 0), [activeList]);

  const visible = useMemo(
    () => (selectedCabinet ? expiryList.filter((item) => item.sample.cabinet === selectedCabinet) : expiryList),
    [expiryList, selectedCabinet],
  );

  const batchLabel = (batchId: string) => {
    const batch = batches.find((b) => b.id === batchId);
    if (!batch) return '未知批次';
    const herb = herbs.find((h) => h.id === batch.herbId);
    return `${batch.batchNo} · ${herb?.name ?? '未知药材'} · 得率 ${batch.yieldRate}%`;
  };

  /** 查找占用某柜位的未处置留样（一柜一份） */
  const occupantOf = (cabinet: string) => samples.find((s) => s.cabinet === cabinet && !isDisposed(s));

  const cabinetOptions = useMemo(
    () =>
      CABINETS.map((c) => {
        const occupant = samples.find((s) => s.cabinet === c && !isDisposed(s));
        return { value: c, label: occupant ? `${c}（${occupant.sampleNo} 占用）` : `${c}（空闲）` };
      }),
    [samples],
  );

  const openCreate = () => {
    const nextIndex = samples.length + 1;
    const batch = batches[0];
    form.resetFields();
    form.setFieldsValue({
      sampleNo: `LY-${batch?.batchNo ?? 'NEW'}-${String(nextIndex).padStart(2, '0')}`,
      batchId: batch?.id,
      amountG: 300,
      retainMonths: 12,
      cabinet: CABINETS.find((c) => !occupantOf(c)) ?? CABINETS[0],
      retainedAt: dayjs(),
    } as unknown as SampleFormValues);
    setOpen(true);
  };

  const submit = async () => {
    const values = await form.validateFields();
    // 每个柜位只放一份留样：碰到占用柜位，提示占用留样编号并拦下
    const occupant = occupantOf(values.cabinet);
    if (occupant) {
      message.error(`柜位 ${values.cabinet} 已被留样 ${occupant.sampleNo} 占用，请先处置该留样或改选其他柜位`);
      return;
    }
    try {
      await createSample({
        sampleNo: values.sampleNo,
        batchId: values.batchId,
        amountG: values.amountG,
        retainMonths: values.retainMonths,
        cabinet: values.cabinet,
        retainedAt: values.retainedAt.toISOString(),
      });
    } catch (error) {
      message.error((error as Error).message);
      return;
    }
    message.success(`已登记留样 ${values.sampleNo}`);
    setOpen(false);
  };

  const openObserve = (record: RetainSample) => {
    setObserveTarget(record);
    observeForm.resetFields();
    observeForm.setFieldsValue({ date: dayjs(), color: '色泽符合标准', odor: '气味正常', mold: '无霉变', observer: '赵敏' } as unknown as ObserveFormValues);
  };

  const submitObserve = async () => {
    if (!observeTarget) return;
    const values = await observeForm.validateFields();
    await appendObserveLog(observeTarget.id, {
      date: values.date.format('YYYY-MM-DD'),
      color: values.color,
      odor: values.odor,
      mold: values.mold,
      observer: values.observer,
      note: values.note,
    });
    const refreshed = useSampleStore.getState().samples.find((s) => s.id === observeTarget.id);
    if (refreshed) {
      setObserveTarget(refreshed);
    }
    message.success('观察记录已按日期追加');
  };

  const openDisposal = (record: RetainSample) => {
    setDisposeTarget(record);
    disposeForm.resetFields();
    disposeForm.setFieldsValue({
      method: '转销毁',
      operator: '赵敏',
      disposedAt: dayjs(),
    } as unknown as DisposalFormValues);
  };

  const submitDisposal = async () => {
    if (!disposeTarget) return;
    const values = await disposeForm.validateFields();
    if (values.method === '延期观察' && !values.extendedMonths) {
      message.error('延期观察必须填写新留样期');
      return;
    }
    try {
      await disposeSample(disposeTarget.id, {
        method: values.method,
        operator: values.operator,
        disposedAt: values.disposedAt.toISOString(),
        extendedMonths: values.method === '延期观察' ? values.extendedMonths : undefined,
        note: values.note,
      });
    } catch (error) {
      message.error((error as Error).message);
      return;
    }
    if (values.method === '延期观察') {
      const refreshed = useSampleStore.getState().samples.find((s) => s.id === disposeTarget.id);
      const newExpire = refreshed ? formatDate(expireDateOf(refreshed)) : '';
      message.success(`已登记延期观察，从 ${values.disposedAt.format('YYYY-MM-DD')} 重算，新到期日 ${newExpire}，原到期日已留档`);
    } else {
      message.success(`已登记${values.method}，留样 ${disposeTarget.sampleNo} 已撤下到期提醒并释放柜位`);
    }
    setDisposeTarget(null);
  };

  const renderExpireAt = (row: SampleExpiry) => {
    const latest = row.disposal;
    const extended = latest?.method === '延期观察' && latest.originalExpireAt;
    return (
      <Space direction="vertical" size={0}>
        <Text>{row.expireAt}</Text>
        {extended ? <Text type="secondary" style={{ fontSize: 12 }}>{`原到期 ${latest.originalExpireAt}（留档）`}</Text> : null}
      </Space>
    );
  };

  const renderState = (row: SampleExpiry) => {
    if (row.state === '已处置') {
      return <Tag color="default">{`已处置 · ${row.disposal?.method ?? ''}`}</Tag>;
    }
    return (
      <Space size={2}>
        <Tag color={STATE_COLOR[row.state]}>{row.state}</Tag>
        {row.disposal?.method === '延期观察' ? <Tag color="blue">已延期</Tag> : null}
      </Space>
    );
  };

  const renderDisposal = (record: DisposalRecord | undefined, count: number) => {
    if (!record) {
      return <Text type="secondary">未处置</Text>;
    }
    return (
      <Space direction="vertical" size={0}>
        <Text>{`${record.method}${count > 1 ? `（共 ${count} 次）` : ''}`}</Text>
        <Text type="secondary" style={{ fontSize: 12 }}>{`${record.operator} · ${formatDate(record.disposedAt)}`}</Text>
        {record.method === '延期观察' && record.extendedMonths ? (
          <Text type="secondary" style={{ fontSize: 12 }}>{`延期 ${record.extendedMonths} 个月`}</Text>
        ) : null}
      </Space>
    );
  };

  const columns: TableColumnsType<SampleExpiry> = [
    { title: '留样编号', width: 170, render: (_, row) => <Text strong>{row.sample.sampleNo}</Text> },
    { title: '关联批次', width: 260, render: (_, row) => batchLabel(row.sample.batchId) },
    { title: '留样量(g)', width: 90, align: 'right', render: (_, row) => row.sample.amountG },
    { title: '留样期(月)', width: 90, align: 'right', render: (_, row) => row.sample.retainMonths },
    { title: '柜位', width: 80, render: (_, row) => <Tag color={row.state === '已处置' ? 'default' : 'green'}>{row.sample.cabinet}</Tag> },
    { title: '留样日期', width: 105, render: (_, row) => formatDate(row.sample.retainedAt) },
    { title: '到期日', width: 160, render: (_, row) => renderExpireAt(row) },
    {
      title: '剩余天数',
      width: 100,
      align: 'right',
      render: (_, row) =>
        row.state === '已处置' ? (
          '-'
        ) : (
          <Text type={row.daysLeft < 0 ? 'danger' : row.daysLeft <= 30 ? 'warning' : undefined}>
            {row.daysLeft < 0 ? `过期 ${Math.abs(row.daysLeft)} 天` : `${row.daysLeft} 天`}
          </Text>
        ),
    },
    { title: '状态', width: 130, render: (_, row) => renderState(row) },
    { title: '处置登记', width: 170, render: (_, row) => renderDisposal(row.disposal, row.sample.disposals?.length ?? 0) },
    { title: '观察记录', width: 80, align: 'right', render: (_, row) => `${row.sample.observeLogs?.length ?? 0} 条` },
    {
      title: '操作',
      width: 190,
      fixed: 'right',
      render: (_, row) => (
        <Space size={2}>
          {row.state !== '已处置' ? (
            <>
              <Button size="small" type="link" onClick={() => openObserve(row.sample)}>
                追加观察
              </Button>
              <Button size="small" type="link" danger={row.state === '已到期'} onClick={() => openDisposal(row.sample)}>
                处置
              </Button>
            </>
          ) : null}
          <Popconfirm
            title={`确认删除留样 ${row.sample.sampleNo}？`}
            description="处置记录将一并从本地台账删除"
            onConfirm={() => removeSample(row.sample.id).then(() => message.success('已删除'))}
          >
            <Button size="small" type="link" danger={row.state !== '已处置'}>
              删除
            </Button>
          </Popconfirm>
        </Space>
      ),
    },
  ];

  const observeColumns: TableColumnsType<ObserveLog> = [
    { title: '观察日期', dataIndex: 'date', width: 110 },
    { title: '色泽', dataIndex: 'color', width: 140 },
    { title: '气味', dataIndex: 'odor', width: 120 },
    { title: '霉变', dataIndex: 'mold', width: 120 },
    { title: '观察人', dataIndex: 'observer', width: 90 },
    { title: '备注', dataIndex: 'note', render: (v?: string) => v ?? '-' },
  ];

  // 延期观察到期日预览：延期当天 + 新留样期（月）
  const extendedPreview = useMemo(() => {
    if (!disposeTarget || disposalMethod !== '延期观察' || !disposalAt || !extendedMonths) return undefined;
    return disposalAt.add(Number(extendedMonths), 'month').format('YYYY-MM-DD');
  }, [disposeTarget, disposalMethod, disposalAt, extendedMonths]);

  const currentExpireAt = disposeTarget ? formatDate(expireDateOf(disposeTarget)) : '';

  return (
    <div>
      <Title level={3} style={{ marginBottom: 4 }}>
        留样与观察台账
      </Title>
      <Paragraph type="secondary">每个柜位只放一份留样，占用柜位登记时会提示留样编号并拦下；到期留样先做处置登记（转销毁 / 延期观察 / 复检放行），延期观察从延期当天重算到期日、原到期日留档；处置后自动撤下到期提醒并释放柜位。</Paragraph>

      <Row gutter={[12, 12]} style={{ marginBottom: 16 }}>
        <Col xs={12} md={6}>
          <StatBadge label="留样总数" value={samples.length} unit="份" hint={`其中已处置 ${expiryList.length - activeList.length} 份`} />
        </Col>
        <Col xs={12} md={6}>
          <StatBadge label="观察中" value={activeList.length - dueList.length} unit="份" status="success" />
        </Col>
        <Col xs={12} md={6}>
          <StatBadge label="30 天内到期" value={dueList.length - expired.length} unit="份" status="warning" />
        </Col>
        <Col xs={12} md={6}>
          <StatBadge label="已到期（待处置）" value={expired.length} unit="份" status={expired.length ? 'error' : 'success'} />
        </Col>
      </Row>

      <Card
        size="small"
        title="留样柜位网格"
        style={{ marginBottom: 16 }}
        extra={
          <Space>
            {selectedCabinet ? <Tag color="green">已选柜位 {selectedCabinet}</Tag> : <Text type="secondary">点击柜位可筛选下方台账</Text>}
            {selectedCabinet ? <Button size="small" onClick={() => setSelectedCabinet(undefined)}>清除柜位筛选</Button> : null}
            <Button size="small" type="primary" onClick={openCreate}>
              登记留样
            </Button>
          </Space>
        }
      >
        <CabinetGrid expiryList={expiryList} selected={selectedCabinet} onSelect={(cabinet) => setSelectedCabinet(cabinet)} />
      </Card>

      {visible.length === 0 ? (
        <EmptyPanel description={selectedCabinet ? `柜位 ${selectedCabinet} 暂无留样` : '暂无留样记录'} actionText="登记留样" onAction={openCreate} />
      ) : (
        <Table rowKey={(row) => row.sample.id} size="small" columns={columns} dataSource={visible} pagination={{ pageSize: 8 }} scroll={{ x: 1600 }} />
      )}

      <Modal open={open} title="登记留样" onCancel={() => setOpen(false)} onOk={submit} okText="保存" cancelText="取消" width={560}>
        <Form form={form} layout="vertical">
          <Form.Item name="sampleNo" label="留样编号" rules={[{ required: true, message: '请输入留样编号' }]}>
            <Input maxLength={32} />
          </Form.Item>
          <Form.Item name="batchId" label="关联炮制批次" rules={[{ required: true, message: '请选择关联批次' }]}>
            <Select showSearch optionFilterProp="label" options={batches.map((b) => ({ label: batchLabel(b.id), value: b.id }))} />
          </Form.Item>
          <Space size={12} style={{ display: 'flex' }} align="start">
            <Form.Item name="amountG" label="留样量(g)" rules={[{ required: true, message: '请输入留样量' }]}>
              <InputNumber min={0} style={{ width: 150 }} />
            </Form.Item>
            <Form.Item name="retainMonths" label="留样期(月)" rules={[{ required: true, message: '请选择留样期' }]}>
              <Select style={{ width: 150 }} options={MONTH_OPTIONS} />
            </Form.Item>
          </Space>
          <Form.Item
            name="cabinet"
            label="柜位（一柜一份，已被占用的柜位不可登记）"
            rules={[{ required: true, message: '请选择柜位' }]}
          >
            <Select showSearch options={cabinetOptions} />
          </Form.Item>
          <Form.Item name="retainedAt" label="留样日期" rules={[{ required: true, message: '请选择留样日期' }]}>
            <DatePicker style={{ width: '100%' }} />
          </Form.Item>
        </Form>
      </Modal>

      <Modal
        open={Boolean(disposeTarget)}
        title={`到期处置登记 · ${disposeTarget?.sampleNo ?? ''}`}
        onCancel={() => setDisposeTarget(null)}
        onOk={submitDisposal}
        okText="提交处置"
        cancelText="取消"
        width={560}
      >
        <Paragraph type="secondary" style={{ marginBottom: 12 }}>
          {`柜位 ${disposeTarget?.cabinet ?? ''} · 当前到期日 ${currentExpireAt}。请写清处置方式、处置人和处置时间。`}
        </Paragraph>
        <Form form={disposeForm} layout="vertical">
          <Form.Item name="method" label="处置方式" rules={[{ required: true, message: '请选择处置方式' }]}>
            <Select options={DISPOSAL_METHODS.map((m) => ({ label: m, value: m }))} />
          </Form.Item>
          <Space size={12} style={{ display: 'flex' }} align="start">
            <Form.Item name="operator" label="处置人" rules={[{ required: true, message: '请填写处置人' }]}>
              <Input style={{ width: 200 }} maxLength={16} />
            </Form.Item>
            <Form.Item name="disposedAt" label="处置时间" rules={[{ required: true, message: '请选择处置时间' }]}>
              <DatePicker showTime={{ format: 'HH:mm' }} format="YYYY-MM-DD HH:mm" style={{ width: 220 }} />
            </Form.Item>
          </Space>
          {disposalMethod === '延期观察' ? (
            <Form.Item
              name="extendedMonths"
              label="新留样期（月）"
              rules={[{ required: true, message: '延期观察必须填写新留样期' }]}
              extra={
                <Text type="secondary">
                  从延期当天重算到期日，原到期日 {currentExpireAt} 留档
                  {extendedPreview ? `；预计新到期日 ${extendedPreview}` : ''}
                </Text>
              }
            >
              <Select style={{ width: 200 }} options={MONTH_OPTIONS} placeholder="请选择新留样期" />
            </Form.Item>
          ) : null}
          <Form.Item name="note" label="备注">
            <Input.TextArea rows={2} maxLength={80} />
          </Form.Item>
        </Form>
      </Modal>

      <Modal
        open={Boolean(observeTarget)}
        title={`留样观察记录 · ${observeTarget?.sampleNo ?? ''}`}
        onCancel={() => setObserveTarget(null)}
        footer={null}
        width={760}
      >
        <Table
          rowKey="id"
          size="small"
          style={{ marginBottom: 12 }}
          columns={observeColumns}
          dataSource={observeTarget?.observeLogs ?? []}
          pagination={false}
          locale={{ emptyText: '暂无观察记录，请在下方追加' }}
        />
        <Form form={observeForm} layout="vertical">
          <Space size={12} style={{ display: 'flex' }} align="start">
            <Form.Item name="date" label="观察日期" rules={[{ required: true, message: '请选择观察日期' }]}>
              <DatePicker style={{ width: 170 }} />
            </Form.Item>
            <Form.Item name="observer" label="观察人" rules={[{ required: true, message: '请填写观察人' }]}>
              <Input style={{ width: 140 }} maxLength={16} />
            </Form.Item>
          </Space>
          <Space size={12} style={{ display: 'flex' }} align="start">
            <Form.Item name="color" label="色泽" rules={[{ required: true, message: '请填写色泽观察' }]}>
              <Input style={{ width: 200 }} maxLength={30} />
            </Form.Item>
            <Form.Item name="odor" label="气味" rules={[{ required: true, message: '请填写气味观察' }]}>
              <Input style={{ width: 200 }} maxLength={30} />
            </Form.Item>
            <Form.Item name="mold" label="霉变" rules={[{ required: true, message: '请填写霉变观察' }]}>
              <Input style={{ width: 200 }} maxLength={30} />
            </Form.Item>
          </Space>
          <Form.Item name="note" label="备注">
            <Input.TextArea rows={2} maxLength={80} />
          </Form.Item>
          <Space>
            <Button type="primary" onClick={submitObserve}>
              追加本次观察（{todayStr()}）
            </Button>
            <Button onClick={() => setObserveTarget(null)}>关闭</Button>
          </Space>
        </Form>
      </Modal>
    </div>
  );
}
