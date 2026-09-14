import { usePageTitle, useParams } from '@aha-app/builder-core';
import { useGetProject, useGetAuditLog, getAuditWorkbookData, exportApprovedRecords, getApprovedRecordsData } from '@/server';
import AppHeader from '@/components/AppHeader';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { History, ChevronRight, Download } from 'lucide-react';
import { toast } from 'sonner';
import { captureError } from '@aha-app/builder-core';
import * as XLSX from 'xlsx';

const ACTION_LABELS: Record<string, string> = {
  project_created: 'Project Created',
  file_imported: 'File Imported',
  analysis_run: 'AI Analysis Run',
  record_approved: 'Approved',
  record_excluded: 'Excluded',
  record_flagged_for_discussion: 'Flagged for Discussion',
  record_consolidated: 'Consolidated',
  record_reset_to_pending: 'Reset to Pending',
  bulk_update: 'Bulk Update',
  consolidation_survivor: 'Consolidation — Survivor',
  consolidation_merged: 'Consolidation — Merged',
  disposition_changed: 'Decision Reversed',
  discussion_created: 'Discussion Created',
  discussion_resolved: 'Discussion Resolved',
  requirements_confirmed: 'Requirements Confirmed',
};

const ACTION_COLORS: Record<string, string> = {
  project_created: 'bg-primary/10 text-primary',
  file_imported: 'bg-blue-100 text-blue-700',
  analysis_run: 'bg-purple-100 text-purple-700',
  record_approved: 'bg-green-100 text-green-700',
  record_excluded: 'bg-red-100 text-red-700',
  record_flagged_for_discussion: 'bg-yellow-100 text-yellow-700',
  record_consolidated: 'bg-purple-100 text-purple-700',
  bulk_update: 'bg-gray-100 text-gray-700',
  consolidation_survivor: 'bg-orange-100 text-orange-700',
  consolidation_merged: 'bg-orange-50 text-orange-600',
  disposition_changed: 'bg-amber-100 text-amber-700',
  discussion_created: 'bg-blue-100 text-blue-700',
  discussion_resolved: 'bg-teal-100 text-teal-700',
};

function buildWorkbook(
  sheets: { name: string; headers: string[]; rows: (string | number | null)[][] }[]
): Blob {
  const wb = XLSX.utils.book_new();
  for (const sheet of sheets) {
    const aoa = [sheet.headers, ...sheet.rows];
    const ws = XLSX.utils.aoa_to_sheet(aoa);
    ws['!cols'] = sheet.headers.map(h => ({ wch: Math.min(Math.max(h.length + 4, 16), 50) }));
    ws['!freeze'] = { xSplit: 0, ySplit: 1, topLeftCell: 'A2', activePane: 'bottomLeft' };
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

export default function AuditPage() {
  const { id } = useParams();
  const projectId = Number(id);
  usePageTitle('Audit Log | MergeFlow');

  const projectQuery = useGetProject({ id: projectId });
  const auditQuery = useGetAuditLog({ projectId, limit: 500 });

  const project = projectQuery.data;
  const entries = auditQuery.data ?? [];

  const handleAuditWorkbook = async () => {
    try {
      const result = await getAuditWorkbookData({ projectId });
      const blob = buildWorkbook([
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
      const blob = buildWorkbook([{ name: 'Approved Records', headers: result.headers, rows: result.rows }]);
      const filename = `${result.projectName.replace(/\s+/g, '_')}_approved_${new Date().toISOString().split('T')[0]}.xlsx`;
      triggerDownload(blob, filename);
      toast.success(`Exported ${result.count} approved records as Excel`);
    } catch (err) {
      captureError(err);
      toast.error('Excel export failed');
    }
  };

  return (
    <div className="min-h-screen bg-background">
      <AppHeader projectId={projectId} projectName={project?.name} />
      <main className="max-w-4xl mx-auto px-6 py-8 pb-16">
        <div className="flex items-start justify-between gap-4 mb-6">
          <div className="flex items-center gap-3">
            <History className="h-6 w-6 text-primary" />
            <div>
              <h1 className="text-2xl font-bold">Audit Log</h1>
              <p className="text-sm text-muted-foreground">
                Append-only history of all decisions, consolidations, and discussions.
                {entries.length > 0 && <span className="ml-2 text-[11px] font-medium text-muted-foreground">{entries.length} events</span>}
              </p>
            </div>
          </div>
          <div className="flex gap-2 flex-wrap shrink-0">
            <Button variant="outline" size="sm" onClick={handleAuditWorkbook}>
              <Download className="h-4 w-4" />
              Download Audit Workbook
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

        <div className="mb-4 bg-muted/60 border border-border rounded p-3">
          <p className="text-xs text-muted-foreground">
            <strong>Append-only:</strong> Audit events are permanent and cannot be edited or deleted through this interface. All state transitions, reversals, consolidations, and discussion resolutions are recorded here for full lifecycle traceability.
          </p>
        </div>

        <Card>
          <CardContent className="p-0">
            {entries.length === 0 ? (
              <div className="text-center py-12 text-muted-foreground">
                <History className="h-10 w-10 mx-auto mb-2 opacity-30" />
                <p>No activity recorded yet</p>
              </div>
            ) : (
              <div className="divide-y divide-border">
                {entries.map((entry) => {
                  const linkedIds = entry.linkedRecordIds as number[] | null;

                  return (
                    <div key={entry.id} className="flex items-start gap-4 px-6 py-4 hover:bg-muted/20 transition-colors">
                      <div className="h-8 w-8 rounded-full bg-primary/10 flex items-center justify-center shrink-0 text-xs font-bold text-primary mt-0.5">
                        {(entry.userFirstName?.[0] ?? entry.userEmail[0]).toUpperCase()}
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="text-sm font-medium">
                            {entry.userFirstName
                              ? `${entry.userFirstName} ${entry.userLastName ?? ''}`.trim()
                              : entry.userEmail}
                          </span>
                          <Badge
                            className={`text-[10px] border-0 px-2 ${ACTION_COLORS[entry.action] ?? 'bg-gray-100 text-gray-700'}`}
                          >
                            {ACTION_LABELS[entry.action] ?? entry.action}
                          </Badge>
                          {entry.recordId && (
                            <span className="text-[10px] text-muted-foreground font-mono">
                              Record #{entry.recordId}
                            </span>
                          )}
                        </div>

                        {/* State transition */}
                        {(entry.previousState || entry.newState) && (
                          <div className="flex items-center gap-1.5 mt-1.5">
                            {entry.previousState && (
                              <span className="text-[10px] bg-muted rounded px-1.5 py-0.5 font-mono capitalize">{entry.previousState}</span>
                            )}
                            {entry.previousState && entry.newState && (
                              <ChevronRight className="h-3 w-3 text-muted-foreground" />
                            )}
                            {entry.newState && (
                              <span className="text-[10px] bg-muted rounded px-1.5 py-0.5 font-mono capitalize font-semibold">{entry.newState}</span>
                            )}
                          </div>
                        )}

                        {/* Reason */}
                        {entry.reason && (
                          <p className="text-xs text-foreground mt-1 italic">
                            Reason: {entry.reason}
                          </p>
                        )}

                        {/* Details */}
                        {entry.details && !entry.reason && (
                          <p className="text-xs text-muted-foreground mt-0.5">{entry.details}</p>
                        )}

                        {/* Linked records */}
                        {linkedIds && linkedIds.length > 0 && (
                          <div className="flex items-center gap-1 mt-1 flex-wrap">
                            <span className="text-[10px] text-muted-foreground">Linked records:</span>
                            {linkedIds.map(rid => (
                              <span key={rid} className="text-[10px] font-mono bg-muted rounded px-1.5 py-0.5">#{rid}</span>
                            ))}
                          </div>
                        )}

                        <p className="text-[10px] text-muted-foreground mt-1">
                          {new Date(entry.createdAt!).toLocaleString()}
                        </p>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </CardContent>
        </Card>
      </main>
    </div>
  );
}
