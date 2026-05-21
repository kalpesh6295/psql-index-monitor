import { useState } from 'react'
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, PieChart, Pie, Cell, CartesianGrid } from 'recharts'
import { useApi } from './hooks/useApi.js'
import { OverviewCards } from './components/OverviewCards.js'
import { DataTable } from './components/DataTable.js'
import { Badge } from './components/Badge.js'
import { Section } from './components/Section.js'
import { ActionItems } from './components/ActionItems.js'
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
  const [tab, setTab] = useState<TabId>('actions')
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

  return (
    <div
      style={{
        minHeight: '100vh',
        background: '#141420',
        color: '#e0e0e0',
        fontFamily: "'Inter', system-ui, sans-serif",
      }}
    >
      <header
        style={{
          padding: '20px 32px',
          borderBottom: '1px solid #2a2a3a',
          display: 'flex',
          alignItems: 'center',
          gap: 16,
        }}
      >
        <h1 style={{ fontSize: 22, fontWeight: 700, margin: 0, color: '#fff' }}>Index Monitor</h1>
        <span style={{ fontSize: 13, color: '#666' }}>PostgreSQL Index Performance Dashboard</span>
      </header>

      <nav
        style={{ padding: '12px 32px', borderBottom: '1px solid #2a2a3a', display: 'flex', gap: 4, overflowX: 'auto' }}
      >
        {tabs.map((t) => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            style={{
              padding: '8px 16px',
              borderRadius: 8,
              border: 'none',
              background: tab === t.id ? '#3b3b5a' : 'transparent',
              color: tab === t.id ? '#fff' : '#888',
              cursor: 'pointer',
              fontSize: 13,
              fontWeight: 500,
              whiteSpace: 'nowrap',
              transition: 'all 0.15s',
            }}
          >
            {t.label}
            {t.id === 'unused' && unused.data && (
              <span
                style={{
                  marginLeft: 6,
                  background: '#3b1219',
                  color: '#f87171',
                  padding: '1px 6px',
                  borderRadius: 10,
                  fontSize: 11,
                }}
              >
                {unused.data.length}
              </span>
            )}
            {t.id === 'duplicates' && duplicates.data && duplicates.data.length > 0 && (
              <span
                style={{
                  marginLeft: 6,
                  background: '#3b2f12',
                  color: '#facc15',
                  padding: '1px 6px',
                  borderRadius: 10,
                  fontSize: 11,
                }}
              >
                {duplicates.data.length}
              </span>
            )}
          </button>
        ))}
      </nav>

      <main style={{ padding: '24px 32px', maxWidth: 1600, margin: '0 auto' }}>
        {tab === 'actions' && (
          <Section title="Action Items" subtitle="Prioritized recommendations based on all index metrics">
            <ActionItems
              unused={unused.data}
              bloat={bloat.data}
              duplicates={duplicates.data}
              tableSizes={tableSizes.data}
              writeOverhead={writeOverhead.data}
              idxRatio={idxRatio.data}
              missing={missing.data}
              seqVsIdx={seqVsIdx.data}
            />
          </Section>
        )}

        {tab === 'overview' && (
          <>
            <Section title="Database Overview" loading={overview.loading} error={overview.error}>
              {overview.data && <OverviewCards data={overview.data} />}
            </Section>

            <Section title="Top 15 Tables by Total Size" loading={tableSizes.loading} error={tableSizes.error}>
              {tableSizes.data && (
                <ResponsiveContainer width="100%" height={400}>
                  <BarChart data={tableSizes.data.slice(0, 15)} margin={{ left: 20, right: 20, bottom: 60 }}>
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
              {allIndexes.data &&
                (() => {
                  const highUse = allIndexes.data.filter((i) => i.scans > 1000).length
                  const medUse = allIndexes.data.filter((i) => i.scans > 0 && i.scans <= 1000).length
                  const noUse = allIndexes.data.filter((i) => i.scans === 0).length
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
                          Total: <strong style={{ color: '#e0e0e0' }}>{allIndexes.data.length}</strong> indexes
                        </div>
                        <div style={{ marginTop: 4 }}>
                          Unused: <strong style={{ color: '#f87171' }}>{noUse}</strong> (
                          {allIndexes.data.length > 0 ? ((noUse / allIndexes.data.length) * 100).toFixed(1) : 0}%)
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
            {allIndexes.data && (
              <DataTable
                data={allIndexes.data}
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
            {unused.data && (
              <>
                {unused.data.length > 0 && (
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
                    {unused.data.length} unused index{unused.data.length !== 1 ? 'es' : ''} found, wasting approximately{' '}
                    {(unused.data.reduce((s, i) => s + i.index_size_bytes, 0) / 1024 / 1024).toFixed(2)} MB
                  </div>
                )}
                <DataTable
                  data={unused.data}
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
            {mostUsed.data && (
              <>
                <ResponsiveContainer width="100%" height={350}>
                  <BarChart data={mostUsed.data.slice(0, 20)} margin={{ left: 20, right: 20, bottom: 80 }}>
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
                    data={mostUsed.data}
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
            {tableSizes.data && (
              <DataTable
                data={tableSizes.data}
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
            {bloat.data && (
              <>
                {bloat.data.length > 0 && (
                  <ResponsiveContainer width="100%" height={350}>
                    <BarChart data={bloat.data.slice(0, 20)} margin={{ left: 20, right: 20, bottom: 80 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#2a2a3a" />
                      <XAxis dataKey="index_name" angle={-45} textAnchor="end" tick={{ fontSize: 10, fill: '#888' }} />
                      <YAxis tick={{ fontSize: 11, fill: '#888' }} unit="%" />
                      <Tooltip
                        contentStyle={{ background: '#1e1e2e', border: '1px solid #444', borderRadius: 8 }}
                        formatter={(v: number) => `${v}%`}
                      />
                      <Bar dataKey="bloat_pct" fill="#f87171" radius={[4, 4, 0, 0]}>
                        {bloat.data.slice(0, 20).map((_, i) => (
                          <Cell
                            key={i}
                            fill={
                              bloat.data![i].bloat_pct > 50
                                ? '#f87171'
                                : bloat.data![i].bloat_pct > 20
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
                    data={bloat.data}
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
            {duplicates.data &&
              (duplicates.data.length === 0 ? (
                <div style={{ padding: 20, color: '#4ade80', background: '#123b1e', borderRadius: 8 }}>
                  No duplicate indexes found
                </div>
              ) : (
                <DataTable
                  data={duplicates.data}
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
            {seqVsIdx.data && (
              <>
                <ResponsiveContainer width="100%" height={350}>
                  <BarChart data={seqVsIdx.data.slice(0, 20)} margin={{ left: 20, right: 20, bottom: 80 }}>
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
                    data={seqVsIdx.data}
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
            {missing.data &&
              (missing.data.length === 0 ? (
                <div style={{ padding: 20, color: '#4ade80', background: '#123b1e', borderRadius: 8 }}>
                  No obvious missing indexes detected
                </div>
              ) : (
                <DataTable
                  data={missing.data}
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
            {writeOverhead.data && (
              <>
                <ResponsiveContainer width="100%" height={350}>
                  <BarChart data={writeOverhead.data.slice(0, 20)} margin={{ left: 20, right: 20, bottom: 80 }}>
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
                    data={writeOverhead.data}
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
            {idxRatio.data && (
              <>
                <ResponsiveContainer width="100%" height={350}>
                  <BarChart
                    data={idxRatio.data.filter((r) => r.ratio > 0).slice(0, 25)}
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
                      {idxRatio.data
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
                    data={idxRatio.data}
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
