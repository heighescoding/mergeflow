import { usePageTitle, useParams, useNavigate, useServerMutation } from '@aha-app/builder-core';
import {
  useGetProject,
  useGetProjectStats,
  useGetAuditLog,
  useGetSourceFiles,
  useGetRequirementsStatus,
  useGetQueueCounts,
  importSourceFile,
  analyzeRecords,
  exportApprovedRecords,
  getAuditWorkbookData,
  getApprovedRecordsData,
} from '@/server';
import AppHeader from '@/components/AppHeader';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import {
  Database,
  CheckCircle2,
  AlertCircle,
  History,
  ArrowRight,
  Upload,
  Sparkles,
  Download,
  Users,
  XCircle,
  Copy,
  ShieldCheck,
  MessageSquare,
  AlertTriangle,
  TrendingUp,
  CheckCheck,
  Clock,
  HelpCircle,
  Lock,
  Flag,
} from 'lucide-react';
import { toast } from 'sonner';
import { useRef } from 'react';
import { captureError } from '@aha-app/builder-core';
import * as XLSX from 'xlsx';

function buildAuditWorkbook(
  projectName: string,
  sheets: { name: string; headers: string[]; rows: (string | number | null)[][] }[]
): Blob {
  const wb = XLSX.utils.book_new();
  for (const sheet of sheets) {
    const aoa = [sheet.headers, ...sheet.rows];
    const ws = XLSX.utils.aoa_to_sheet(aoa);
    // Column widths based on header length
    ws['!cols'] = sheet.headers.map(h => ({ wch: Math.min(Math.max(h.length + 4, 16), 50) }));
    // Freeze first row
    ws['!freeze'] = { xSplit: 0, ySplit: 1, topLeftCell: 'A2', activePane: 'bottomLeft' };
    // Auto filter across all columns
    if (ws['!ref']) ws['!autofilter'] = { ref: ws['!ref'] };
    XLSX.utils.book_append_sheet(wb, ws, sheet.name);
  }
  const buf = XLSX.write(wb, { bookType: 'xlsx', type: 'array' });
  return new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
}

function triggerDownload(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = filename; a.click();
  URL.revokeObjectURL(url);
}

function parseCSV(text: string): { columns: string[]; rows: Record<string, unknown>[] } {
  const lines = text.trim().split('\n');
  if (lines.length === 0) return { columns: [], rows: [] };

  const parseLine = (line: string): string[] => {
    const result: string[] = [];
    let current = '';
    let inQuotes = false;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (ch === '"') {
        if (inQuotes && line[i + 1] === '"') { current += '"'; i++; }
        else inQuotes = !inQuotes;
      } else if (ch === ',' && !inQuotes) {
        result.push(current.trim());
        current = '';
      } else {
        current += ch;
      }
    }
    result.push(current.trim());
    return result;
  };

  const columns = parseLine(lines[0]);
  const rows = lines.slice(1).filter(l => l.trim()).map(line => {
    const values = parseLine(line);
    const row: Record<string, unknown> = {};
    columns.forEach((col, i) => { row[col] = values[i] ?? ''; });
    return row;
  });

  return { columns, rows };
}

const STATE_LABELS: Record<string, string> = {
  pending: 'Pending',
  approved: 'Approved',
  excluded: 'Excluded',
  discussing: 'In Discussion',
  consolidated: 'Consolidated',
};

function stateTransitionLabel(prev: string | null, next: string | null): string {
  if (prev && next && prev !== next) {
    return `${STATE_LABELS[prev] ?? prev} → ${STATE_LABELS[next] ?? next}`;
  }
  return '';
}

const ACTION_LABELS: Record<string, string> = {
  project_created: 'Project created',
  file_imported: 'File imported',
  analysis_run: 'Analysis run',
  record_approved: 'Record approved',
  record_excluded: 'Record excluded',
  record_flagged_for_discussion: 'Sent to discussion',
  record_consolidated: 'Record consolidated',
  record_reset_to_pending: 'Disposition reversed',
  bulk_update: 'Bulk records updated',
  requirement_confirmed: 'Requirement confirmed',
  requirements_bulk_confirmed: 'Requirements confirmed',
  requirements_suggested: 'AI suggested requirements',
  discussion_created: 'Discussion opened',
  discussion_resolved: 'Discussion resolved',
  disposition_changed: 'Disposition changed',
  migration_finalized: 'Migration finalized',
  migration_reopened: 'Migration reopened',
};

export default function ProjectDashboard() {
  const { id } = useParams();
  const projectId = Number(id);
  const navigate = useNavigate();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const projectQuery = useGetProject({ id: projectId });
  const statsQuery = useGetProjectStats({ projectId });
  const queueQuery = useGetQueueCounts({ projectId });
  const auditQuery = useGetAuditLog({ projectId, limit: 8 });
  const filesQuery = useGetSourceFiles({ projectId });
  const reqStatusQuery = useGetRequirementsStatus({ projectId });

  const project = projectQuery.data;
  const stats = statsQuery.data;
  const queue = queueQuery.data;
  const auditLog = auditQuery.data ?? [];
  const sourceFiles = filesQuery.data ?? [];
  const reqStatus = reqStatusQuery.data;

  usePageTitle(project ? `${project.name} | MergeFlow` : 'Project | MergeFlow');

  // Redirect to setup if not yet complete
  if (project && !project.setupComplete) {
    navigate(`/projects/${projectId}/setup`);
    return null;
  }

  const importMutation = useServerMutation(importSourceFile, {
    query: filesQuery,
    onSuccess: () => {
      statsQuery.refetch?.();
      toast.success('File imported successfully');
    },
    onError: () => toast.error('Failed to import file'),
  });

  const analyzeMutation = useServerMutation(analyzeRecords, {
    onSuccess: (result) => {
      statsQuery.refetch?.();
      queueQuery.refetch?.();
      reqStatusQuery.refetch?.();
      if (result.requirementsWarning) {
        toast.warning(result.requirementsWarning, { duration: 8000 });
      } else {
        toast.success(`Analyzed ${result.analyzed} records, found ${result.issues} issues`);
      }
    },
    onError: () => toast.error('Analysis failed'),
  });

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const text = await file.text();
      const { columns, rows } = parseCSV(text);
      if (rows.length === 0) { toast.error('No data rows found in file'); return; }
      importMutation.mutate({ projectId, fileName: file.name, columns, rows });
    } catch (err) {
      captureError(err);
      toast.error('Failed to read file');
    }
    e.target.value = '';
  };

  const handleExportCsv = async () => {
    try {
      const result = await exportApprovedRecords({ projectId });
      const blob = new Blob([result.csv], { type: 'text/csv' });
      triggerDownload(blob, result.filename);
      toast.success(`Exported ${result.count} approved records`);
    } catch (err) {
      captureError(err);
      toast.error('CSV export failed');
    }
  };

  const handleExportApprovedExcel = async () => {
    try {
      const result = await getApprovedRecordsData({ projectId });
      const blob = buildAuditWorkbook(result.projectName, [{
        name: 'Approved Records',
        headers: result.headers,
        rows: result.rows,
      }]);
      const filename = `${result.projectName.replace(/\s+/g, '_')}_approved_${new Date().toISOString().split('T')[0]}.xlsx`;
      triggerDownload(blob, filename);
      toast.success(`Exported ${result.count} approved records as Excel`);
    } catch (err) {
      captureError(err);
      toast.error('Excel export failed');
    }
  };

  const handleAuditWorkbook = async () => {
    try {
      const result = await getAuditWorkbookData({ projectId });
      const blob = buildAuditWorkbook(result.projectName, [
        { name: 'Record Summary', ...result.recordSummary },
        { name: 'Decision Audit Trail', ...result.decisionAudit },
        { name: 'Discussions & Resolutions', ...result.discussions },
      ]);
      const filename = `${result.projectName.replace(/\s+/g, '_')}_audit_workbook_${new Date().toISOString().split('T')[0]}.xlsx`;
      triggerDownload(blob, filename);
      toast.success('Audit workbook downloaded');
    } catch (err) {
      captureError(err);
      toast.error('Audit workbook download failed');
    }
  };

  const total = stats?.total ?? 0;
  const approved = stats?.approved ?? 0;
  const pending = stats?.pending ?? 0;
  const discussing = stats?.discussing ?? 0;
  const excluded = stats?.excluded ?? 0;
  const consolidated = stats?.consolidated ?? 0;
  const analyzed = stats?.analyzed ?? 0;
  const withFinalDisposition = stats?.withFinalDisposition ?? 0;

  const readyForApproval = queue?.ready_for_approval ?? 0;
  const ruleViolations = queue?.rule_violations ?? 0;
  const duplicates = queue?.duplicates ?? 0;
  const needsDiscussion = queue?.needs_discussion ?? 0;
  const recommendedExclusions = queue?.recommended_exclusions ?? 0;
  const aiFindings = queue?.ai_findings ?? 0;

  // Records that are clean (analyzed, ready, no issues) but not yet acted on
  const cleanPending = readyForApproval;
  // Records with issues (any analysis finding suggesting non-trivial action)
  const issueCount = ruleViolations + duplicates + needsDiscussion + recommendedExclusions + aiFindings;

  const allResolved = total > 0 && withFinalDisposition === total;

  if (!project && !projectQuery.loading) {
    return (
      <div className="min-h-screen bg-background">
        <AppHeader />
        <main className="max-w-4xl mx-auto px-6 py-16 text-center">
          <h2 className="text-2xl font-bold mb-2">Project not found</h2>
          <Button onClick={() => navigate('/projects')}>Back to Projects</Button>
        </main>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background">
      <AppHeader projectId={projectId} projectName={project?.name} />
      <main className="max-w-6xl mx-auto px-6 py-8 pb-16">
        {/* Header */}
        <div className="flex items-start justify-between mb-8">
          <div>
            <h1 className="text-3xl font-bold tracking-tight">{project?.name ?? '...'}</h1>
            <p className="text-muted-foreground mt-1">
              {project?.sourceOrg} → {project?.destinationOrg}
            </p>
          </div>
          <div className="flex gap-2 flex-wrap justify-end">
            <Button variant="outline" size="sm" onClick={handleAuditWorkbook}>
              <Download className="h-4 w-4" />
              Audit Workbook
            </Button>
            <Button variant="outline" size="sm" onClick={handleExportCsv}>
              <Download className="h-4 w-4" />
              Export Approved CSV
            </Button>
            <Button size="sm" onClick={handleExportApprovedExcel}>
              <Download className="h-4 w-4" />
              Export Approved Excel
            </Button>
          </div>
        </div>

        {/* Finalized banner */}
        {project?.status === 'finalized' && (
          <div className="flex items-center gap-3 p-4 rounded-lg border-2 border-primary bg-primary/5 mb-6">
            <Lock className="h-6 w-6 text-primary shrink-0" />
            <div className="flex-1">
              <p className="font-semibold text-primary">
                Migration Finalized
              </p>
              <p className="text-xs text-muted-foreground mt-0.5">
                {total} of {total} source records tracked · {withFinalDisposition} finalized · Immutable snapshot preserved.
                {project.finalizedAt ? ` Finalized on ${new Date(project.finalizedAt).toLocaleDateString()}.` : ''}
              </p>
            </div>
            <div className="flex gap-2 flex-wrap">
              <Button size="sm" variant="outline" onClick={handleAuditWorkbook} className="shrink-0">
                <Download className="h-4 w-4" /> Audit Workbook
              </Button>
              <Button size="sm" variant="outline" onClick={handleExportCsv} className="shrink-0">
                <Download className="h-4 w-4" /> Export CSV
              </Button>
              <Button size="sm" onClick={handleExportApprovedExcel} className="shrink-0">
                <Download className="h-4 w-4" /> Export Excel
              </Button>
            </div>
          </div>
        )}

        {/* Completion banner (review complete but not yet finalized) */}
        {allResolved && project?.status !== 'finalized' && (
          <div className="flex items-center gap-3 p-4 rounded-lg border-2 border-green-400 bg-green-50 mb-6">
            <CheckCheck className="h-6 w-6 text-green-700 shrink-0" />
            <div className="flex-1">
              <p className="font-semibold text-green-900">
                {total} of {total} source records tracked — review complete
              </p>
              <p className="text-xs text-green-700 mt-0.5">
                All {withFinalDisposition} records finalized. Open the review workspace to complete the migration.
              </p>
            </div>
            <Button size="sm" onClick={() => navigate(`/projects/${projectId}/review`)} className="shrink-0 bg-green-700 hover:bg-green-800 text-white gap-1">
              <Flag className="h-4 w-4" />
              Complete Migration
            </Button>
          </div>
        )}

        {/* Requirements warning */}
        {reqStatus && reqStatus.unconfirmedCount > 0 && (
          <div className="flex items-start gap-3 p-4 rounded-lg border border-yellow-200 bg-yellow-50 mb-6">
            <AlertCircle className="h-5 w-5 text-yellow-700 shrink-0 mt-0.5" />
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium text-yellow-900">
                {reqStatus.unconfirmedCount} destination requirement(s) awaiting review
              </p>
              <p className="text-xs text-yellow-700 mt-0.5">
                Confirm all requirements before running analysis for accurate readiness results.
              </p>
            </div>
            <Button
              size="sm"
              variant="outline"
              className="shrink-0 border-yellow-400 text-yellow-800 hover:bg-yellow-100"
              onClick={() => navigate(`/projects/${projectId}/requirements`)}
            >
              <ShieldCheck className="h-4 w-4" />
              Review Requirements
            </Button>
          </div>
        )}

        {/* Analysis outdated */}
        {reqStatus?.analysisOutdated && reqStatus.unconfirmedCount === 0 && analyzed > 0 && (
          <div className="flex items-start gap-3 p-4 rounded-lg border border-blue-200 bg-blue-50 mb-6">
            <AlertCircle className="h-5 w-5 text-blue-700 shrink-0 mt-0.5" />
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium text-blue-900">
                Requirements have changed — previous analysis is outdated
              </p>
              <p className="text-xs text-blue-700 mt-0.5">
                Re-run analysis to get current migration readiness results.
              </p>
            </div>
            <Button
              size="sm"
              variant="outline"
              className="shrink-0 border-blue-400 text-blue-800 hover:bg-blue-100"
              onClick={() => analyzeMutation.mutate({ projectId })}
              disabled={analyzeMutation.isPending || total === 0}
            >
              <Sparkles className="h-4 w-4" />
              Re-run Analysis
            </Button>
          </div>
        )}

        {/* Two-column: Analysis Summary + Disposition Progress */}
        <div className="grid gap-4 lg:grid-cols-2 mb-6">

          {/* Analysis Summary */}
          <Card>
            <CardHeader className="pb-3">
              <div className="flex items-center justify-between">
                <div>
                  <CardTitle className="flex items-center gap-2">
                    <Sparkles className="h-4 w-4 text-primary" />
                    Analysis Summary
                  </CardTitle>
                  <CardDescription className="mt-1">
                    {total === 0
                      ? 'No records imported yet'
                      : analyzed === 0
                        ? 'Run AI analysis to classify records'
                        : `${analyzed.toLocaleString()} of ${total.toLocaleString()} records analyzed`}
                  </CardDescription>
                </div>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => analyzeMutation.mutate({ projectId })}
                  disabled={analyzeMutation.isPending || total === 0}
                  className="shrink-0"
                >
                  <Sparkles className="h-3.5 w-3.5" />
                  {analyzeMutation.isPending ? 'Analyzing…' : analyzed > 0 ? 'Re-run' : 'Run Analysis'}
                </Button>
              </div>
            </CardHeader>
            <CardContent className="space-y-1.5">
              {/* Totals row */}
              <div className="grid grid-cols-2 gap-2 pb-2 mb-1 border-b border-border">
                <div className="text-center p-2 rounded bg-muted/40">
                  <div className="text-xl font-bold">{total.toLocaleString()}</div>
                  <div className="text-[11px] text-muted-foreground">Source records tracked</div>
                </div>
                <div className="text-center p-2 rounded bg-muted/40">
                  <div className="text-xl font-bold">{analyzed.toLocaleString()}</div>
                  <div className="text-[11px] text-muted-foreground">Analyzed</div>
                </div>
                <div className="text-center p-2 rounded bg-green-50 border border-green-100">
                  <div className="text-xl font-bold text-green-700">{withFinalDisposition.toLocaleString()}</div>
                  <div className="text-[11px] text-muted-foreground">Source records finalized</div>
                </div>
                <div className="text-center p-2 rounded bg-muted/40">
                  <div className={`text-xl font-bold ${(total - withFinalDisposition) > 0 ? 'text-amber-600' : 'text-muted-foreground'}`}>{(total - withFinalDisposition).toLocaleString()}</div>
                  <div className="text-[11px] text-muted-foreground">Unresolved</div>
                </div>
              </div>

              {/* Ready for approval — clean records */}
              <AnalysisRow
                icon={<CheckCircle2 className="h-3.5 w-3.5 text-green-600" />}
                label="Ready for Approval"
                count={readyForApproval}
                color="text-green-700"
                onClick={readyForApproval > 0 ? () => navigate(`/projects/${projectId}/review?queue=ready_for_approval`) : undefined}
                tooltip="Clean records with no issues, awaiting human approval"
              />

              {/* Issues */}
              <AnalysisRow
                icon={<AlertTriangle className="h-3.5 w-3.5 text-red-500" />}
                label="Destination Rule Failures"
                count={ruleViolations}
                color="text-red-700"
                onClick={ruleViolations > 0 ? () => navigate(`/projects/${projectId}/review?queue=rule_violations`) : undefined}
                tooltip="Records that fail one or more destination field requirements"
              />

              <AnalysisRow
                icon={<Copy className="h-3.5 w-3.5 text-orange-500" />}
                label="Likely Duplicates"
                count={duplicates}
                color="text-orange-700"
                onClick={duplicates > 0 ? () => navigate(`/projects/${projectId}/review?queue=duplicates`) : undefined}
                tooltip="Records that appear to duplicate an existing entry"
              />

              <AnalysisRow
                icon={<MessageSquare className="h-3.5 w-3.5 text-blue-500" />}
                label="Needs Clarification"
                count={needsDiscussion}
                color="text-blue-700"
                onClick={needsDiscussion > 0 ? () => navigate(`/projects/${projectId}/review?queue=needs_discussion`) : undefined}
                tooltip="Records where AI suggests a discussion or question before proceeding"
              />

              <AnalysisRow
                icon={<XCircle className="h-3.5 w-3.5 text-gray-500" />}
                label="Recommended Exclusions"
                count={recommendedExclusions}
                color="text-gray-700"
                onClick={recommendedExclusions > 0 ? () => navigate(`/projects/${projectId}/review?queue=recommended_exclusions`) : undefined}
                tooltip="Records AI recommends excluding from migration"
              />

              {aiFindings > 0 && (
                <AnalysisRow
                  icon={<HelpCircle className="h-3.5 w-3.5 text-purple-500" />}
                  label="Other AI Findings"
                  count={aiFindings}
                  color="text-purple-700"
                  onClick={() => navigate(`/projects/${projectId}/review?queue=ai_findings`)}
                  tooltip="Records flagged for manual review by AI"
                />
              )}
            </CardContent>
          </Card>

          {/* Disposition Progress */}
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="flex items-center gap-2">
                <TrendingUp className="h-4 w-4 text-primary" />
                Disposition Progress
              </CardTitle>
              <CardDescription className="mt-1">
                {allResolved ? (
                  <span className="text-green-700 font-medium">
                    {total} of {total} source records tracked · {withFinalDisposition} finalized ✓
                  </span>
                ) : (
                  <span>
                    <span className="font-semibold text-foreground">{withFinalDisposition.toLocaleString()}</span>
                    {' of '}
                    <span className="font-semibold text-foreground">{total.toLocaleString()}</span>
                    {' finalized'}
                    {discussing > 0 && (
                      <span className="text-muted-foreground"> · {discussing} in discussion</span>
                    )}
                  </span>
                )}
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-2">
              {/* Progress bar for overall completion */}
              <div className="mb-3">
                <div className="flex justify-between text-xs text-muted-foreground mb-1">
                  <span>Finalized</span>
                  <span>{total > 0 ? Math.round((withFinalDisposition / total) * 100) : 0}%</span>
                </div>
                <Progress
                  value={total > 0 ? (withFinalDisposition / total) * 100 : 0}
                  className="h-2"
                />
              </div>

              {/* Final dispositions */}
              <div className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider mb-1 mt-3">Final dispositions</div>
              <DispositionRow
                label="Approved"
                count={approved}
                total={total}
                barColor="bg-green-500"
                textColor="text-green-700"
                onClick={approved > 0 ? () => navigate(`/projects/${projectId}/review?status=approved`) : undefined}
              />
              <DispositionRow
                label="Consolidated"
                count={consolidated}
                total={total}
                barColor="bg-purple-500"
                textColor="text-purple-700"
                onClick={consolidated > 0 ? () => navigate(`/projects/${projectId}/review?status=consolidated`) : undefined}
              />
              <DispositionRow
                label="Excluded"
                count={excluded}
                total={total}
                barColor="bg-red-400"
                textColor="text-red-700"
                onClick={excluded > 0 ? () => navigate(`/projects/${projectId}/review?status=excluded`) : undefined}
              />

              {/* In-progress / not yet decided */}
              <div className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider mb-1 mt-3">Awaiting decision</div>
              <DispositionRow
                label="In Discussion"
                count={discussing}
                total={total}
                barColor="bg-blue-500"
                textColor="text-blue-700"
                onClick={discussing > 0 ? () => navigate(`/projects/${projectId}/review?status=discussing`) : undefined}
              />
              <DispositionRow
                label="Pending Decision"
                count={pending}
                total={total}
                barColor="bg-yellow-400"
                textColor="text-yellow-700"
                onClick={pending > 0 ? () => navigate(`/projects/${projectId}/review?status=pending`) : undefined}
                note={cleanPending > 0 ? `${cleanPending} ready for quick approval` : undefined}
              />

              <div className="pt-2 mt-1">
                <Button className="w-full" onClick={() => navigate(`/projects/${projectId}/review`)}>
                  Open Review Workspace
                  <ArrowRight className="h-4 w-4" />
                </Button>
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Bottom row: Recent Activity + Quick Actions */}
        <div className="grid gap-4 lg:grid-cols-3">

          {/* Recent Activity */}
          <Card className="lg:col-span-2">
            <CardHeader className="pb-3">
              <CardTitle className="flex items-center gap-2">
                <History className="h-4 w-4" />
                Recent Activity
              </CardTitle>
            </CardHeader>
            <CardContent>
              {auditLog.length === 0 ? (
                <p className="text-xs text-muted-foreground py-4 text-center">No activity yet</p>
              ) : (
                <div className="divide-y divide-border">
                  {auditLog
                    .filter(entry => entry.action !== 'analysis_run' || entry.details)
                    .slice(0, 6)
                    .map((entry) => {
                      const transition = stateTransitionLabel(entry.previousState, entry.newState);
                      const hasRecord = !!entry.recordId;
                      return (
                        <div key={entry.id} className="flex items-start gap-3 py-2.5 first:pt-0 last:pb-0">
                          <div className="h-7 w-7 rounded-full bg-primary/10 flex items-center justify-center shrink-0 text-[10px] font-bold text-primary mt-0.5">
                            {(entry.userFirstName?.[0] ?? entry.userEmail[0]).toUpperCase()}
                          </div>
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2 flex-wrap">
                              <span className="text-xs font-medium">
                                {ACTION_LABELS[entry.action] ?? entry.action}
                              </span>
                              {transition && (
                                <Badge variant="outline" className="text-[9px] px-1.5 h-4 bg-muted/60">
                                  {transition}
                                </Badge>
                              )}
                            </div>
                            {entry.details && (
                              <p className="text-[11px] text-muted-foreground line-clamp-1 mt-0.5">{entry.details}</p>
                            )}
                            <p className="text-[10px] text-muted-foreground mt-0.5">
                              {entry.userFirstName ? `${entry.userFirstName} ${entry.userLastName ?? ''}`.trim() : entry.userEmail}
                              {' · '}
                              {new Date(entry.createdAt!).toLocaleString()}
                            </p>
                          </div>
                          {hasRecord && (
                            <button
                              className="shrink-0 text-[10px] text-primary hover:underline cursor-pointer mt-1"
                              onClick={() => navigate(`/projects/${projectId}/review?recordId=${entry.recordId}`)}
                            >
                              View
                            </button>
                          )}
                        </div>
                      );
                    })}
                </div>
              )}
              <Button
                variant="ghost"
                size="sm"
                className="w-full mt-3 text-xs"
                onClick={() => navigate(`/projects/${projectId}/audit`)}
              >
                View Full Audit Log
                <ArrowRight className="h-3 w-3" />
              </Button>
            </CardContent>
          </Card>

          {/* Quick Actions */}
          <div className="space-y-4">
            {/* Import */}
            <Card className="border-2 border-dashed border-border hover:border-primary/40 transition-colors">
              <CardContent className="flex flex-col items-center justify-center p-5 text-center">
                <Upload className="h-7 w-7 text-muted-foreground mb-2" />
                <h3 className="font-semibold text-sm mb-1">Import Source Data</h3>
                <p className="text-xs text-muted-foreground mb-3">Upload a CSV to add records</p>
                <input
                  type="file"
                  accept=".csv"
                  ref={fileInputRef}
                  onChange={handleFileUpload}
                  className="hidden"
                />
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => fileInputRef.current?.click()}
                  disabled={importMutation.isPending}
                >
                  {importMutation.isPending ? 'Importing...' : 'Choose CSV File'}
                </Button>
                {sourceFiles.length > 0 && (
                  <p className="text-[10px] text-muted-foreground mt-2">{sourceFiles.length} file(s) imported</p>
                )}
              </CardContent>
            </Card>

            {/* Requirements */}
            <Card>
              <CardContent className="p-5">
                <div className="flex items-center gap-2 mb-2">
                  <ShieldCheck className="h-5 w-5 text-primary" />
                  <h3 className="font-semibold text-sm">Destination Requirements</h3>
                  {reqStatus && reqStatus.unconfirmedCount > 0 && (
                    <Badge variant="outline" className="text-[9px] px-1.5 bg-yellow-50 text-yellow-700 border-yellow-200">
                      {reqStatus.unconfirmedCount} pending
                    </Badge>
                  )}
                </div>
                <p className="text-xs text-muted-foreground mb-3">
                  {reqStatus
                    ? `${reqStatus.confirmedCount} confirmed`
                    : 'Define destination schema requirements'}
                </p>
                <Button
                  variant="outline"
                  size="sm"
                  className="w-full"
                  onClick={() => navigate(`/projects/${projectId}/requirements`)}
                >
                  Manage Requirements
                  <ArrowRight className="h-3.5 w-3.5" />
                </Button>
              </CardContent>
            </Card>

            {/* Field Mapping */}
            <Card>
              <CardContent className="p-5">
                <div className="flex items-center gap-2 mb-2">
                  <Database className="h-5 w-5 text-primary" />
                  <h3 className="font-semibold text-sm">Field Mapping & Rules</h3>
                </div>
                <p className="text-xs text-muted-foreground mb-3">
                  Map source columns and configure advanced validation
                </p>
                <Button
                  variant="outline"
                  size="sm"
                  className="w-full"
                  onClick={() => navigate(`/projects/${projectId}/schema`)}
                >
                  Configure Mapping
                  <ArrowRight className="h-3.5 w-3.5" />
                </Button>
              </CardContent>
            </Card>
          </div>
        </div>
      </main>
    </div>
  );
}

// Sub-components

function AnalysisRow({
  icon,
  label,
  count,
  color,
  onClick,
  tooltip,
}: {
  icon: React.ReactNode;
  label: string;
  count: number;
  color: string;
  onClick?: () => void;
  tooltip?: string;
}) {
  const isClickable = !!onClick && count > 0;
  return (
    <div
      className={`flex items-center gap-2.5 px-2 py-1.5 rounded transition-colors ${isClickable ? 'hover:bg-muted/50 cursor-pointer' : 'opacity-60'}`}
      onClick={isClickable ? onClick : undefined}
      title={tooltip}
    >
      {icon}
      <span className="flex-1 text-xs text-muted-foreground">{label}</span>
      <span className={`text-sm font-bold ${count > 0 ? color : 'text-muted-foreground'}`}>
        {count.toLocaleString()}
      </span>
      {isClickable && <ArrowRight className="h-3 w-3 text-muted-foreground" />}
    </div>
  );
}

function DispositionRow({
  label,
  count,
  total,
  barColor,
  textColor,
  onClick,
  note,
}: {
  label: string;
  count: number;
  total: number;
  barColor: string;
  textColor: string;
  onClick?: () => void;
  note?: string;
}) {
  const isClickable = !!onClick && count > 0;
  return (
    <div
      className={`flex items-center gap-3 ${isClickable ? 'cursor-pointer group' : 'opacity-60'}`}
      onClick={isClickable ? onClick : undefined}
    >
      <div className="w-[90px] shrink-0">
        <span className="text-xs text-muted-foreground">{label}</span>
        {note && <p className="text-[10px] text-green-600 leading-tight">{note}</p>}
      </div>
      <div className="flex-1 bg-muted rounded-full h-1.5 overflow-hidden">
        <div
          className={`h-full ${barColor} rounded-full transition-all`}
          style={{ width: total > 0 ? `${(count / total) * 100}%` : '0%' }}
        />
      </div>
      <div className={`w-10 text-xs font-bold text-right ${count > 0 ? textColor : 'text-muted-foreground'}`}>
        {count.toLocaleString()}
      </div>
    </div>
  );
}