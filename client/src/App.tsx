import { useMemo, useState } from 'react'
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, PieChart, Pie, Cell, CartesianGrid } from 'recharts'
import { useApi } from './hooks/useApi.js'
import { usePrivacy, maskTable, maskIndex, maskDefinition, maskColumnList, maskSize } from './hooks/usePrivacy.js'
import { OverviewCards } from './components/OverviewCards.js'
import { DataTable } from './components/DataTable.js'
import { Badge } from './components/Badge.js'
import { Section } from './components/Section.js'
import { ActionItems } from './components/ActionItems.js'
import { Doctor } from './components/Doctor.js'
import type {
  Overview,
  IndexInfo,
  UnusedIndex,
  MostUsedIndex,
  TableSize,
  BloatedIndex,
  DuplicateIndex,
  SeqVsIdx,
  MissingIndex,
  WriteOverhead,
  IndexTableRatio,
} from './types/index.js'

const COLORS = ['#60a5fa', '#f87171', '#4ade80', '#facc15', '#a78bfa', '#fb923c', '#22d3ee', '#e879f9']

const tabs = [
  { id: 'doctor', label: 'Doctor' },
  { id: 'actions', label: 'Action Items' },
  { id: 'overview', label: 'Overview' },
  { id: 'all', label: 'All Indexes' },
  { id: 'unused', label: 'Unused' },
  { id: 'most-used', label: 'Most Used' },
  { id: 'tables', label: 'Table Sizes' },
  { id: 'bloat', label: 'Bloat' },
  { id: 'duplicates', label: 'Duplicates' },
  { id: 'seq-vs-idx', label: 'Seq vs Idx' },
  { id: 'missing', label: 'Missing Indexes' },
  { id: 'write-overhead', label: 'Write Overhead' },
  { id: 'idx-ratio', label: 'Index:Table Ratio' },
] as const

type TabId = (typeof tabs)[number]['id']

function formatNum(n: number | string) {
  return Number(n).toLocaleString()
}

export default function App() {
  const [tab, setTab] = useState<TabId>('doctor')
  const { privacy, toggle: togglePrivacy } = usePrivacy()
  const overview = useApi<Overview>('overview')
  const allIndexes = useApi<IndexInfo[]>('indexes')
  const unused = useApi<UnusedIndex[]>('unused')
  const mostUsed = useApi<MostUsedIndex[]>('most-used')
  const tableSizes = useApi<TableSize[]>('table-sizes')
  const bloat = useApi<BloatedIndex[]>('bloat')
  const duplicates = useApi<DuplicateIndex[]>('duplicates')
  const seqVsIdx = useApi<SeqVsIdx[]>('seq-vs-idx')
  const missing = useApi<MissingIndex[]>('missing')
  const writeOverhead = useApi<WriteOverhead[]>('write-overhead')
  const idxRatio = useApi<IndexTableRatio[]>('index-table-ratio')

  const overviewData = useMemo<Overview | null>(
    () =>
      privacy && overview.data
        ? {
            ...overview.data,
            total_index_size: maskSize(overview.data.total_index_size),
            total_db_size: maskSize(overview.data.total_db_size),
            total_table_size: maskSize(overview.data.total_table_size),
          }
        : overview.data,
    [overview.data, privacy],
  )
  const allIndexesData = useMemo<IndexInfo[] | null>(
    () =>
      privacy && allIndexes.data
        ? allIndexes.data.map((i) => ({
            ...i,
            table_name: maskTable(i.table_name),
            index_name: maskIndex(i.index_name),
            definition: maskDefinition(i.definition),
            index_size: maskSize(i.index_size),
            table_size: maskSize(i.table_size),
          }))
        : allIndexes.data,
    [allIndexes.data, privacy],
  )
  const unusedData = useMemo<UnusedIndex[] | null>(
    () =>
      privacy && unused.data
        ? unused.data.map((i) => ({
            ...i,
            table_name: maskTable(i.table_name),
            index_name: maskIndex(i.index_name),
            definition: maskDefinition(i.definition),
            index_size: maskSize(i.index_size),
          }))
        : unused.data,
    [unused.data, privacy],
  )
  const mostUsedData = useMemo<MostUsedIndex[] | null>(
    () =>
      privacy && mostUsed.data
        ? mostUsed.data.map((i) => ({
            ...i,
            table_name: maskTable(i.table_name),
            index_name: maskIndex(i.index_name),
            definition: maskDefinition(i.definition),
            index_size: maskSize(i.index_size),
          }))
        : mostUsed.data,
    [mostUsed.data, privacy],
  )
  const tableSizesData = useMemo<TableSize[] | null>(
    () =>
      privacy && tableSizes.data
        ? tableSizes.data.map((t) => ({
            ...t,
            table_name: maskTable(t.table_name),
            table_size: maskSize(t.table_size),
            indexes_size: maskSize(t.indexes_size),
            total_size: maskSize(t.total_size),
          }))
        : tableSizes.data,
    [tableSizes.data, privacy],
  )
  const bloatData = useMemo<BloatedIndex[] | null>(
    () =>
      privacy && bloat.data
        ? bloat.data.map((b) => ({
            ...b,
            table_name: maskTable(b.table_name),
            index_name: maskIndex(b.index_name),
            index_size: maskSize(b.index_size),
            bloat_size: maskSize(b.bloat_size),
          }))
        : bloat.data,
    [bloat.data, privacy],
  )
  const duplicatesData = useMemo<DuplicateIndex[] | null>(
    () =>
      privacy && duplicates.data
        ? duplicates.data.map((d) => ({
            ...d,
            table_name: maskTable(d.table_name),
            index_names: d.index_names.map((n) => maskIndex(n)),
            index_sizes: d.index_sizes.map((s) => maskSize(s)),
            index_columns: maskColumnList(d.index_columns),
          }))
        : duplicates.data,
    [duplicates.data, privacy],
  )
  const seqVsIdxData = useMemo<SeqVsIdx[] | null>(
    () =>
      privacy && seqVsIdx.data
        ? seqVsIdx.data.map((s) => ({ ...s, table_name: maskTable(s.table_name) }))
        : seqVsIdx.data,
    [seqVsIdx.data, privacy],
  )
  const missingData = useMemo<MissingIndex[] | null>(
    () =>
      privacy && missing.data
        ? missing.data.map((m) => ({ ...m, table_name: maskTable(m.table_name) }))
        : missing.data,
    [missing.data, privacy],
  )
  const writeOverheadData = useMemo<WriteOverhead[] | null>(
    () =>
      privacy && writeOverhead.data
        ? writeOverhead.data.map((w) => ({
            ...w,
            table_name: maskTable(w.table_name),
            indexes_size: maskSize(w.indexes_size),
          }))
        : writeOverhead.data,
    [writeOverhead.data, privacy],
  )
  const idxRatioData = useMemo<IndexTableRatio[] | null>(
    () =>
      privacy && idxRatio.data
        ? idxRatio.data.map((r) => ({
            ...r,
            table_name: maskTable(r.table_name),
            table_size: maskSize(r.table_size),
            indexes_size: maskSize(r.indexes_size),
          }))
        : idxRatio.data,
    [idxRatio.data, privacy],
  )

  return (
    <div className="app">
      <header className="app-header">
        <div className="pulse-logo" aria-hidden>
          <svg width="26" height="26" viewBox="0 0 26 26">
            <polyline points="1,15 7,15 9.5,8 13,20 15.5,4 18,15 25,15" />
          </svg>
        </div>
        <div>
          <h1 className="brand-name">
            Index <em>Doctor</em>
          </h1>
          <div className="brand-sub">postgres index health, diagnosed with evidence</div>
        </div>
        <button
          onClick={togglePrivacy}
          title="Redact table, index, and column names for sharing"
          className="btn btn-ghost"
          style={{ marginLeft: 'auto', padding: '6px 12px', fontSize: 12, ...(privacy ? { color: 'var(--good)', borderColor: 'rgba(47,179,68,0.4)' } : {}) }}
        >
          {privacy ? 'Privacy: ON' : 'Privacy: OFF'}
        </button>
      </header>

      <nav className="tab-nav">
        {tabs.map((t) => (
          <button key={t.id} onClick={() => setTab(t.id)} className={`tab${tab === t.id ? ' active' : ''}`}>
            {t.label}
            {t.id === 'unused' && unusedData && unusedData.length > 0 && (
              <span className="tab-count red">{unusedData.length}</span>
            )}
            {t.id === 'duplicates' && duplicatesData && duplicatesData.length > 0 && (
              <span className="tab-count yellow">{duplicatesData.length}</span>
            )}
          </button>
        ))}
      </nav>

      <main className="app-main">
        {tab === 'actions' && (
          <Section title="Action Items" subtitle="Prioritized recommendations based on all index metrics">
            <ActionItems
              unused={unusedData}
              bloat={bloatData}
              duplicates={duplicatesData}
              tableSizes={tableSizesData}
              writeOverhead={writeOverheadData}
              idxRatio={idxRatioData}
              missing={missingData}
              seqVsIdx={seqVsIdxData}
              privacy={privacy}
            />
          </Section>
        )}

        {tab === 'doctor' && <Doctor />}

        {tab === 'overview' && (
          <>
            <Section title="Database Overview" loading={overview.loading} error={overview.error}>
              {overviewData && <OverviewCards data={overviewData} />}
            </Section>

            <Section title="Top 15 Tables by Total Size" loading={tableSizes.loading} error={tableSizes.error}>
              {tableSizesData && (
                <ResponsiveContainer width="100%" height={400}>
                  <BarChart data={tableSizesData.slice(0, 15)} margin={{ left: 20, right: 20, bottom: 60 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#2a2a3a" />
                    <XAxis dataKey="table_name" angle={-45} textAnchor="end" tick={{ fontSize: 11, fill: '#888' }} />
                    <YAxis
                      tick={{ fontSize: 11, fill: '#888' }}
                      tickFormatter={(v) => `${(v / 1024 / 1024).toFixed(0)} MB`}
                    />
                    <Tooltip
                      contentStyle={{ background: '#1e1e2e', border: '1px solid #444', borderRadius: 8 }}
                      labelStyle={{ color: '#fff' }}
                      formatter={(value: number, name: string) => [
                        `${(value / 1024 / 1024).toFixed(2)} MB`,
                        name === 'table_size_bytes' ? 'Table' : 'Indexes',
                      ]}
                    />
                    <Bar
                      dataKey="table_size_bytes"
                      stackId="a"
                      fill="#60a5fa"
                      name="table_size_bytes"
                      radius={[0, 0, 0, 0]}
                    />
                    <Bar
                      dataKey="indexes_size_bytes"
                      stackId="a"
                      fill="#f87171"
                      name="indexes_size_bytes"
                      radius={[4, 4, 0, 0]}
                    />
                  </BarChart>
                </ResponsiveContainer>
              )}
            </Section>

            <Section title="Index Usage Distribution" loading={allIndexes.loading} error={allIndexes.error}>
              {allIndexesData &&
                (() => {
                  const highUse = allIndexesData.filter((i) => i.scans > 1000).length
                  const medUse = allIndexesData.filter((i) => i.scans > 0 && i.scans <= 1000).length
                  const noUse = allIndexesData.filter((i) => i.scans === 0).length
                  const pieData = [
                    { name: 'High Use (>1000)', value: highUse },
                    { name: 'Low Use (1-1000)', value: medUse },
                    { name: 'Never Used', value: noUse },
                  ]
                  return (
                    <div style={{ display: 'flex', alignItems: 'center', gap: 40 }}>
                      <ResponsiveContainer width={300} height={250}>
                        <PieChart>
                          <Pie
                            data={pieData}
                            dataKey="value"
                            cx="50%"
                            cy="50%"
                            outerRadius={100}
                            label={({ name, value }) => `${name}: ${value}`}
                          >
                            {pieData.map((_, i) => (
                              <Cell key={i} fill={['#4ade80', '#facc15', '#f87171'][i]} />
                            ))}
                          </Pie>
                          <Tooltip
                            contentStyle={{ background: '#1e1e2e', border: '1px solid #444', borderRadius: 8 }}
                          />
                        </PieChart>
                      </ResponsiveContainer>
                      <div style={{ fontSize: 13, color: '#888' }}>
                        <div>
                          Total: <strong style={{ color: '#e0e0e0' }}>{allIndexesData.length}</strong> indexes
                        </div>
                        <div style={{ marginTop: 4 }}>
                          Unused: <strong style={{ color: '#f87171' }}>{noUse}</strong> (
                          {allIndexesData.length > 0 ? ((noUse / allIndexesData.length) * 100).toFixed(1) : 0}%)
                        </div>
                      </div>
                    </div>
                  )
                })()}
            </Section>
          </>
        )}

        {tab === 'all' && (
          <Section
            title="All Indexes"
            subtitle="Every index in the database, sorted by size"
            loading={allIndexes.loading}
            error={allIndexes.error}
          >
            {allIndexesData && (
              <DataTable
                data={allIndexesData}
                searchKeys={['table_name', 'index_name']}
                columns={[
                  { key: 'table_name', label: 'Table' },
                  { key: 'index_name', label: 'Index' },
                  { key: 'index_size', label: 'Size', render: (r) => r.index_size },
                  { key: 'scans', label: 'Scans', render: (r) => formatNum(r.scans) },
                  { key: 'tuples_read', label: 'Tuples Read', render: (r) => formatNum(r.tuples_read) },
                  {
                    key: 'is_primary',
                    label: 'Type',
                    render: (r) =>
                      r.is_primary ? (
                        <Badge color="blue">PK</Badge>
                      ) : r.is_unique ? (
                        <Badge color="green">Unique</Badge>
                      ) : (
                        <Badge color="gray">Index</Badge>
                      ),
                  },
                  {
                    key: 'definition',
                    label: 'Definition',
                    width: '30%',
                    render: (r) => <code style={{ fontSize: 11, wordBreak: 'break-all' }}>{r.definition}</code>,
                  },
                ]}
              />
            )}
          </Section>
        )}

        {tab === 'unused' && (
          <Section
            title="Unused Indexes"
            subtitle="Indexes with zero scans since last stats reset. Candidates for removal (excluding PK and unique constraints)."
            loading={unused.loading}
            error={unused.error}
          >
            {unusedData && (
              <>
                {unusedData.length > 0 && (
                  <div
                    style={{
                      background: '#3b1219',
                      border: '1px solid #5c2030',
                      borderRadius: 8,
                      padding: '12px 16px',
                      marginBottom: 16,
                      fontSize: 13,
                      color: '#f87171',
                    }}
                  >
                    {unusedData.length} unused index{unusedData.length !== 1 ? 'es' : ''} found, wasting approximately{' '}
                    {(unusedData.reduce((s, i) => s + i.index_size_bytes, 0) / 1024 / 1024).toFixed(2)} MB
                  </div>
                )}
                <DataTable
                  data={unusedData}
                  searchKeys={['table_name', 'index_name']}
                  columns={[
                    { key: 'table_name', label: 'Table' },
                    { key: 'index_name', label: 'Index' },
                    { key: 'index_size', label: 'Size' },
                    {
                      key: 'definition',
                      label: 'Definition',
                      width: '40%',
                      render: (r) => <code style={{ fontSize: 11, wordBreak: 'break-all' }}>{r.definition}</code>,
                    },
                  ]}
                />
              </>
            )}
          </Section>
        )}

        {tab === 'most-used' && (
          <Section
            title="Most Used Indexes"
            subtitle="Top 50 indexes by scan count"
            loading={mostUsed.loading}
            error={mostUsed.error}
          >
            {mostUsedData && (
              <>
                <ResponsiveContainer width="100%" height={350}>
                  <BarChart data={mostUsedData.slice(0, 20)} margin={{ left: 20, right: 20, bottom: 80 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#2a2a3a" />
                    <XAxis dataKey="index_name" angle={-45} textAnchor="end" tick={{ fontSize: 10, fill: '#888' }} />
                    <YAxis tick={{ fontSize: 11, fill: '#888' }} />
                    <Tooltip
                      contentStyle={{ background: '#1e1e2e', border: '1px solid #444', borderRadius: 8 }}
                      formatter={(v: number) => formatNum(v)}
                    />
                    <Bar dataKey="scans" fill="#60a5fa" radius={[4, 4, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
                <div style={{ marginTop: 24 }}>
                  <DataTable
                    data={mostUsedData}
                    searchKeys={['table_name', 'index_name']}
                    columns={[
                      { key: 'table_name', label: 'Table' },
                      { key: 'index_name', label: 'Index' },
                      { key: 'scans', label: 'Scans', render: (r) => formatNum(r.scans) },
                      { key: 'tuples_read', label: 'Tuples Read', render: (r) => formatNum(r.tuples_read) },
                      { key: 'tuples_fetched', label: 'Tuples Fetched', render: (r) => formatNum(r.tuples_fetched) },
                      { key: 'index_size', label: 'Size' },
                    ]}
                  />
                </div>
              </>
            )}
          </Section>
        )}

        {tab === 'tables' && (
          <Section
            title="Table Sizes & Health"
            subtitle="All tables with size breakdown, row counts, and vacuum status"
            loading={tableSizes.loading}
            error={tableSizes.error}
          >
            {tableSizesData && (
              <DataTable
                data={tableSizesData}
                searchKeys={['table_name']}
                columns={[
                  { key: 'table_name', label: 'Table' },
                  { key: 'table_size', label: 'Table Size' },
                  { key: 'indexes_size', label: 'Indexes Size' },
                  { key: 'total_size', label: 'Total Size' },
                  { key: 'index_count', label: '# Indexes' },
                  { key: 'live_rows', label: 'Live Rows', render: (r) => formatNum(r.live_rows) },
                  {
                    key: 'dead_rows',
                    label: 'Dead Rows',
                    render: (r) => (
                      <span
                        style={{ color: r.dead_row_pct > 10 ? '#f87171' : r.dead_row_pct > 5 ? '#facc15' : '#ccc' }}
                      >
                        {formatNum(r.dead_rows)}{' '}
                        {r.dead_row_pct > 0 && <span style={{ fontSize: 11 }}>({r.dead_row_pct}%)</span>}
                      </span>
                    ),
                  },
                  { key: 'seq_scan', label: 'Seq Scans', render: (r) => formatNum(r.seq_scan) },
                  { key: 'idx_scan', label: 'Idx Scans', render: (r) => formatNum(r.idx_scan) },
                  {
                    key: 'last_autovacuum',
                    label: 'Last Vacuum',
                    render: (r) => {
                      const d = r.last_autovacuum || r.last_vacuum
                      return d ? new Date(d).toLocaleDateString() : <span style={{ color: '#f87171' }}>Never</span>
                    },
                  },
                ]}
              />
            )}
          </Section>
        )}

        {tab === 'bloat' && (
          <Section
            title="Index Bloat"
            subtitle="Estimated bloat in B-tree indexes. High bloat means wasted space — consider REINDEX."
            loading={bloat.loading}
            error={bloat.error}
          >
            {bloatData && (
              <>
                {bloatData.length > 0 && (
                  <ResponsiveContainer width="100%" height={350}>
                    <BarChart data={bloatData.slice(0, 20)} margin={{ left: 20, right: 20, bottom: 80 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#2a2a3a" />
                      <XAxis dataKey="index_name" angle={-45} textAnchor="end" tick={{ fontSize: 10, fill: '#888' }} />
                      <YAxis tick={{ fontSize: 11, fill: '#888' }} unit="%" />
                      <Tooltip
                        contentStyle={{ background: '#1e1e2e', border: '1px solid #444', borderRadius: 8 }}
                        formatter={(v: number) => `${v}%`}
                      />
                      <Bar dataKey="bloat_pct" fill="#f87171" radius={[4, 4, 0, 0]}>
                        {bloatData.slice(0, 20).map((_, i) => (
                          <Cell
                            key={i}
                            fill={
                              bloatData![i].bloat_pct > 50
                                ? '#f87171'
                                : bloatData![i].bloat_pct > 20
                                ? '#facc15'
                                : '#4ade80'
                            }
                          />
                        ))}
                      </Bar>
                    </BarChart>
                  </ResponsiveContainer>
                )}
                <div style={{ marginTop: 24 }}>
                  <DataTable
                    data={bloatData}
                    searchKeys={['table_name', 'index_name']}
                    columns={[
                      { key: 'table_name', label: 'Table' },
                      { key: 'index_name', label: 'Index' },
                      { key: 'index_size', label: 'Index Size' },
                      {
                        key: 'bloat_pct',
                        label: 'Bloat %',
                        render: (r) => (
                          <Badge color={r.bloat_pct > 50 ? 'red' : r.bloat_pct > 20 ? 'yellow' : 'green'}>
                            {r.bloat_pct}%
                          </Badge>
                        ),
                      },
                      { key: 'bloat_size', label: 'Bloat Size' },
                    ]}
                  />
                </div>
              </>
            )}
          </Section>
        )}

        {tab === 'duplicates' && (
          <Section
            title="Duplicate Indexes"
            subtitle="Indexes on the same columns — usually safe to remove duplicates"
            loading={duplicates.loading}
            error={duplicates.error}
          >
            {duplicatesData &&
              (duplicatesData.length === 0 ? (
                <div style={{ padding: 20, color: '#4ade80', background: '#123b1e', borderRadius: 8 }}>
                  No duplicate indexes found
                </div>
              ) : (
                <DataTable
                  data={duplicatesData}
                  searchKeys={['table_name', 'index_columns']}
                  columns={[
                    { key: 'table_name', label: 'Table' },
                    { key: 'index_columns', label: 'Columns' },
                    {
                      key: 'index_names',
                      label: 'Duplicate Indexes',
                      render: (r) => (r.index_names as string[]).join(', '),
                    },
                    { key: 'index_sizes', label: 'Sizes', render: (r) => (r.index_sizes as string[]).join(', ') },
                  ]}
                />
              ))}
          </Section>
        )}

        {tab === 'seq-vs-idx' && (
          <Section
            title="Sequential vs Index Scans"
            subtitle="Tables with high sequential scans may benefit from better indexing"
            loading={seqVsIdx.loading}
            error={seqVsIdx.error}
          >
            {seqVsIdxData && (
              <>
                <ResponsiveContainer width="100%" height={350}>
                  <BarChart data={seqVsIdxData.slice(0, 20)} margin={{ left: 20, right: 20, bottom: 80 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#2a2a3a" />
                    <XAxis dataKey="table_name" angle={-45} textAnchor="end" tick={{ fontSize: 10, fill: '#888' }} />
                    <YAxis tick={{ fontSize: 11, fill: '#888' }} />
                    <Tooltip
                      contentStyle={{ background: '#1e1e2e', border: '1px solid #444', borderRadius: 8 }}
                      formatter={(v: number) => formatNum(v)}
                    />
                    <Bar dataKey="seq_scan" fill="#f87171" name="Seq Scans" />
                    <Bar dataKey="idx_scan" fill="#4ade80" name="Idx Scans" />
                  </BarChart>
                </ResponsiveContainer>
                <div style={{ marginTop: 24 }}>
                  <DataTable
                    data={seqVsIdxData}
                    searchKeys={['table_name']}
                    columns={[
                      { key: 'table_name', label: 'Table' },
                      {
                        key: 'seq_scan',
                        label: 'Seq Scans',
                        render: (r) => <span style={{ color: '#f87171' }}>{formatNum(r.seq_scan)}</span>,
                      },
                      {
                        key: 'idx_scan',
                        label: 'Idx Scans',
                        render: (r) => <span style={{ color: '#4ade80' }}>{formatNum(r.idx_scan)}</span>,
                      },
                      {
                        key: 'idx_scan_pct',
                        label: 'Idx %',
                        render: (r) => (
                          <Badge color={r.idx_scan_pct > 90 ? 'green' : r.idx_scan_pct > 50 ? 'yellow' : 'red'}>
                            {r.idx_scan_pct}%
                          </Badge>
                        ),
                      },
                      { key: 'seq_tup_read', label: 'Seq Tuples', render: (r) => formatNum(r.seq_tup_read) },
                      { key: 'live_rows', label: 'Live Rows', render: (r) => formatNum(r.live_rows) },
                    ]}
                  />
                </div>
              </>
            )}
          </Section>
        )}

        {tab === 'missing' && (
          <Section
            title="Possibly Missing Indexes"
            subtitle="Tables with many sequential scans, lots of rows, and few index scans — may benefit from new indexes"
            loading={missing.loading}
            error={missing.error}
          >
            {missingData &&
              (missingData.length === 0 ? (
                <div style={{ padding: 20, color: '#4ade80', background: '#123b1e', borderRadius: 8 }}>
                  No obvious missing indexes detected
                </div>
              ) : (
                <DataTable
                  data={missingData}
                  searchKeys={['table_name']}
                  columns={[
                    { key: 'table_name', label: 'Table' },
                    { key: 'live_rows', label: 'Rows', render: (r) => formatNum(r.live_rows) },
                    {
                      key: 'seq_scan',
                      label: 'Seq Scans',
                      render: (r) => <span style={{ color: '#f87171' }}>{formatNum(r.seq_scan)}</span>,
                    },
                    { key: 'idx_scan', label: 'Idx Scans', render: (r) => formatNum(r.idx_scan) },
                    {
                      key: 'avg_seq_tup_read',
                      label: 'Avg Seq Tuples/Scan',
                      render: (r) => formatNum(r.avg_seq_tup_read),
                    },
                    { key: 'seq_tup_read', label: 'Total Seq Tuples', render: (r) => formatNum(r.seq_tup_read) },
                  ]}
                />
              ))}
          </Section>
        )}

        {tab === 'write-overhead' && (
          <Section
            title="Write Overhead"
            subtitle="Tables ranked by total write cost (writes x index count). High-write tables with many indexes pay the most per mutation."
            loading={writeOverhead.loading}
            error={writeOverhead.error}
          >
            {writeOverheadData && (
              <>
                <ResponsiveContainer width="100%" height={350}>
                  <BarChart data={writeOverheadData.slice(0, 20)} margin={{ left: 20, right: 20, bottom: 80 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#2a2a3a" />
                    <XAxis dataKey="table_name" angle={-45} textAnchor="end" tick={{ fontSize: 10, fill: '#888' }} />
                    <YAxis tick={{ fontSize: 11, fill: '#888' }} />
                    <Tooltip
                      contentStyle={{ background: '#1e1e2e', border: '1px solid #444', borderRadius: 8 }}
                      formatter={(v: number) => formatNum(v)}
                    />
                    <Bar dataKey="inserts" stackId="a" fill="#60a5fa" name="Inserts" />
                    <Bar dataKey="updates" stackId="a" fill="#facc15" name="Updates" />
                    <Bar dataKey="deletes" stackId="a" fill="#f87171" name="Deletes" radius={[4, 4, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
                <div style={{ marginTop: 24 }}>
                  <DataTable
                    data={writeOverheadData}
                    searchKeys={['table_name']}
                    columns={[
                      { key: 'table_name', label: 'Table' },
                      { key: 'index_count', label: '# Indexes' },
                      { key: 'inserts', label: 'Inserts', render: (r) => formatNum(r.inserts) },
                      { key: 'updates', label: 'Updates', render: (r) => formatNum(r.updates) },
                      { key: 'deletes', label: 'Deletes', render: (r) => formatNum(r.deletes) },
                      {
                        key: 'total_writes',
                        label: 'Total Writes',
                        render: (r) => <strong>{formatNum(r.total_writes)}</strong>,
                      },
                      {
                        key: 'hot_update_pct',
                        label: 'HOT %',
                        render: (r) => (
                          <Badge color={r.hot_update_pct > 90 ? 'green' : r.hot_update_pct > 50 ? 'yellow' : 'red'}>
                            {r.hot_update_pct}%
                          </Badge>
                        ),
                      },
                      {
                        key: 'write_index_cost',
                        label: 'Write x Index Cost',
                        render: (r) => formatNum(r.write_index_cost),
                      },
                      { key: 'indexes_size', label: 'Indexes Size' },
                      { key: 'idx_scan', label: 'Idx Scans', render: (r) => formatNum(r.idx_scan) },
                    ]}
                  />
                </div>
              </>
            )}
          </Section>
        )}

        {tab === 'idx-ratio' && (
          <Section
            title="Index-to-Table Size Ratio"
            subtitle="Tables where indexes are larger than the data itself — a sign of over-indexing"
            loading={idxRatio.loading}
            error={idxRatio.error}
          >
            {idxRatioData && (
              <>
                <ResponsiveContainer width="100%" height={350}>
                  <BarChart
                    data={idxRatioData.filter((r) => r.ratio > 0).slice(0, 25)}
                    margin={{ left: 20, right: 20, bottom: 80 }}
                  >
                    <CartesianGrid strokeDasharray="3 3" stroke="#2a2a3a" />
                    <XAxis dataKey="table_name" angle={-45} textAnchor="end" tick={{ fontSize: 10, fill: '#888' }} />
                    <YAxis
                      tick={{ fontSize: 11, fill: '#888' }}
                      label={{ value: 'Ratio', angle: -90, position: 'insideLeft', fill: '#888' }}
                    />
                    <Tooltip
                      contentStyle={{ background: '#1e1e2e', border: '1px solid #444', borderRadius: 8 }}
                      formatter={(v: number) => `${v}x`}
                    />
                    <Bar dataKey="ratio" radius={[4, 4, 0, 0]}>
                      {idxRatioData
                        .filter((r) => r.ratio > 0)
                        .slice(0, 25)
                        .map((r, i) => (
                          <Cell key={i} fill={r.ratio > 2 ? '#f87171' : r.ratio > 1 ? '#facc15' : '#4ade80'} />
                        ))}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
                <div style={{ marginTop: 24 }}>
                  <DataTable
                    data={idxRatioData}
                    searchKeys={['table_name']}
                    columns={[
                      { key: 'table_name', label: 'Table' },
                      { key: 'table_size', label: 'Table Size' },
                      { key: 'indexes_size', label: 'Indexes Size' },
                      {
                        key: 'ratio',
                        label: 'Ratio',
                        render: (r) => (
                          <Badge color={r.ratio > 2 ? 'red' : r.ratio > 1 ? 'yellow' : 'green'}>{r.ratio}x</Badge>
                        ),
                      },
                      { key: 'index_count', label: '# Indexes' },
                      { key: 'live_rows', label: 'Live Rows', render: (r) => formatNum(r.live_rows) },
                    ]}
                  />
                </div>
              </>
            )}
          </Section>
        )}
      </main>
    </div>
  )
}
