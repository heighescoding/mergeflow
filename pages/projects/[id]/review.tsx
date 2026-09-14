import { usePageTitle, useParams, useServerMutation, captureError, useNavigate } from '@aha-app/builder-core';
import {
  useGetProject,
  useGetRecords,
  useGetRecord,
  useGetQueueCounts,
  useGetStakeholders,
  useGetFinalizationChecklist,
  useGetAppUsers,
  useGetMigrationValues,
  createStakeholder,
  updateRecordStatus,
  bulkUpdateRecordStatus,
  bulkExcludeRecords,
  addDiscussion,
  resolveDiscussion,
  addDiscussionResponse,
  changeDisposition,
  analyzeRecords,
  analyzeRecordAI,
  getConsolidationCandidates,
  finalizeConsolidation,
  finalizeProject,
  reopenProject,
  setMigrationValue,
} from '@/server';
import AppHeader from '@/components/AppHeader';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogDescription,
} from '@/components/ui/dialog';
import {
  Check,
  X,
  MessageSquare,
  Sparkles,
  AlertTriangle,
  Search,
  Copy,
  RefreshCw,
  ShieldAlert,
  Brain,
  CheckCircle2,
  CircleDot,
  Layers,
  HelpCircle,
  Ban,
  AlertCircle,
  ListFilter,
  ChevronRight,
  ChevronDown,
  Users,
  History,
  RotateCcw,
  ArrowRight,
  Loader2,
  CheckSquare,
  TrendingUp,
  UserPlus,
  Send,
  StickyNote,
  UserCheck,
  Flag,
  Lock,
  Unlock,
  PartyPopper,
  Download,
  Square,
  Mail,
  MailX,
} from 'lucide-react';
import { useState, useMemo, useEffect } from 'react';
import { toast } from 'sonner';
import type { MigrationRecord, MigrationStakeholder, MigrationValue } from '@/db/schema';
import type { RuleFinding, AIFinding, RecommendedDisposition, DuplicateMatch } from '@/data/analysis.server';
import type { QueueFilter } from '@/data/records.server';
import type { ConsolidationCandidates } from '@/data/consolidations.server';
import type { FinalizationChecklist } from '@/data/projects.server';

// ---- Config ----

const STATUS_CONFIG: Record<string, { label: string; color: string }> = {
  pending: { label: 'Pending', color: 'bg-yellow-100 text-yellow-800' },
  approved: { label: 'Approved', color: 'bg-green-100 text-green-700' },
  excluded: { label: 'Excluded', color: 'bg-red-100 text-red-700' },
  discussing: { label: 'Discussing', color: 'bg-blue-100 text-blue-700' },
  consolidated: { label: 'Consolidated', color: 'bg-purple-100 text-purple-700' },
};

const DISPOSITION_CONFIG: Record<RecommendedDisposition, {
  label: string;
  icon: React.ReactNode;
  cardClass: string;
  badgeClass: string;
}> = {
  ready_for_approval: {
    label: 'Ready for Approval',
    icon: <CheckCircle2 className="h-4 w-4 text-green-600" />,
    cardClass: 'border-green-300 bg-green-50/60',
    badgeClass: 'bg-green-100 text-green-700 border-green-200',
  },
  consolidate: {
    label: 'Consolidate',
    icon: <Layers className="h-4 w-4 text-orange-600" />,
    cardClass: 'border-orange-300 bg-orange-50/60',
    badgeClass: 'bg-orange-100 text-orange-700 border-orange-200',
  },
  discuss: {
    label: 'Needs Discussion',
    icon: <HelpCircle className="h-4 w-4 text-blue-600" />,
    cardClass: 'border-blue-300 bg-blue-50/60',
    badgeClass: 'bg-blue-100 text-blue-700 border-blue-200',
  },
  exclude: {
    label: 'Recommended Exclusion',
    icon: <Ban className="h-4 w-4 text-gray-600" />,
    cardClass: 'border-gray-300 bg-gray-50/60',
    badgeClass: 'bg-gray-100 text-gray-700 border-gray-200',
  },
  needs_manual_review: {
    label: 'Needs Manual Review',
    icon: <AlertCircle className="h-4 w-4 text-amber-600" />,
    cardClass: 'border-amber-300 bg-amber-50/60',
    badgeClass: 'bg-amber-100 text-amber-700 border-amber-200',
  },
};

// Sidebar queue groups
const ANALYSIS_QUEUES: Array<{ key: QueueFilter; label: string; icon: React.ReactNode; countKey: string }> = [
  { key: 'ready_for_approval', label: 'Ready for Approval', icon: <CheckCircle2 className="h-3.5 w-3.5" />, countKey: 'ready_for_approval' },
  { key: 'rule_violations', label: 'Rule Violations', icon: <ShieldAlert className="h-3.5 w-3.5" />, countKey: 'rule_violations' },
  { key: 'duplicates', label: 'Likely Duplicates', icon: <Layers className="h-3.5 w-3.5" />, countKey: 'duplicates' },
  { key: 'needs_discussion', label: 'Needs Clarification', icon: <HelpCircle className="h-3.5 w-3.5" />, countKey: 'needs_discussion' },
  { key: 'recommended_exclusions', label: 'Recommended Exclusions', icon: <Ban className="h-3.5 w-3.5" />, countKey: 'recommended_exclusions' },
];

const WORKFLOW_QUEUES: Array<{ key: QueueFilter; label: string; icon: React.ReactNode; countKey: string }> = [
  { key: 'discussing', label: 'In Discussion', icon: <MessageSquare className="h-3.5 w-3.5" />, countKey: 'discussing' },
];

const DISPOSITION_QUEUES: Array<{ key: QueueFilter; label: string; icon: React.ReactNode; countKey: string }> = [
  { key: 'pending', label: 'Pending', icon: <CircleDot className="h-3.5 w-3.5" />, countKey: 'pending' },
  { key: 'approved', label: 'Approved', icon: <Check className="h-3.5 w-3.5" />, countKey: 'approved' },
  { key: 'consolidated', label: 'Consolidated', icon: <Layers className="h-3.5 w-3.5" />, countKey: 'consolidated' },
  { key: 'excluded', label: 'Excluded', icon: <X className="h-3.5 w-3.5" />, countKey: 'excluded' },
];

const ALL_QUEUES = [...ANALYSIS_QUEUES, ...WORKFLOW_QUEUES, ...DISPOSITION_QUEUES,
  { key: 'all' as QueueFilter, label: 'All Records', icon: <ListFilter className="h-3.5 w-3.5" />, countKey: 'all' }];

// ---- Consolidation Dialog ----

interface ConsolidationDialogProps {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  projectId: number;
  record: MigrationRecord;
  onDone: () => void;
}

function ConsolidationDialog({ open, onOpenChange, projectId, record, onDone }: ConsolidationDialogProps) {
  const [step, setStep] = useState<'loading' | 'compare' | 'error'>('loading');
  const [candidates, setCandidates] = useState<ConsolidationCandidates | null>(null);
  const [survivingId, setSurvivingId] = useState<number>(record.id);
  const [fieldSelections, setFieldSelections] = useState<Record<string, { value: unknown; fromRecordId: number }>>({});
  const [reason, setReason] = useState('');
  const [loadError, setLoadError] = useState('');

  useEffect(() => {
    if (!open) return;
    setStep('loading');
    setLoadError('');
    setCandidates(null);
    setSurvivingId(record.id);
    setFieldSelections({});
    setReason('');

    getConsolidationCandidates({ recordId: record.id, projectId })
      .then(data => {
        setCandidates(data);
        const initial: Record<string, { value: unknown; fromRecordId: number }> = {};
        for (const cf of data.conflictingFields) {
          const primaryData = data.primaryRecord.data as Record<string, unknown>;
          initial[cf.field] = { value: primaryData[cf.field], fromRecordId: data.primaryRecord.id };
        }
        setFieldSelections(initial);
        setStep('compare');
      })
      .catch(err => {
        captureError(err);
        setLoadError('Could not load consolidation candidates.');
        setStep('error');
      });
  }, [open, record.id, projectId]);

  const dataObj = (r: MigrationRecord) => r.data as Record<string, unknown>;

  const finalizeMutation = useServerMutation(finalizeConsolidation, {
    onSuccess: () => {
      toast.success('Records consolidated. Original source data preserved.');
      onDone();
      onOpenChange(false);
    },
    onError: () => toast.error('Consolidation failed'),
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Layers className="h-5 w-5 text-orange-600" />
            Consolidate Duplicate Records
          </DialogTitle>
          <DialogDescription>
            {candidates && candidates.candidateRecords.some(r => r.id < 0)
              ? 'This source record matches an existing destination system record. Confirm consolidation — the destination record will survive and this source record will be marked consolidated.'
              : 'Review the evidence, choose which record survives, and resolve any conflicting field values. Original source records are permanently preserved.'}
          </DialogDescription>
        </DialogHeader>

        {(step === 'loading' || step === 'error') && (
          <div className="py-12 flex flex-col items-center gap-3 text-muted-foreground">
            {step === 'error' ? (
              <>
                <AlertCircle className="h-8 w-8 text-destructive" />
                <p className="text-destructive text-sm">{loadError}</p>
                <Button variant="outline" size="sm" onClick={() => onOpenChange(false)}>Close</Button>
              </>
            ) : (
              <>
                <Loader2 className="h-8 w-8 animate-spin" />
                <p className="text-sm">Loading duplicate evidence…</p>
              </>
            )}
          </div>
        )}

        {step === 'compare' && candidates && (
          <div className="space-y-5">
            <div>
              <p className="text-sm font-semibold mb-3">Choose the Surviving Record</p>
              <div className="grid gap-3" style={{ gridTemplateColumns: `repeat(${candidates.candidateRecords.length + 1}, 1fr)` }}>
                {[candidates.primaryRecord, ...candidates.candidateRecords].map(r => (
                  <div
                    key={r.id}
                    className={`rounded-lg border-2 p-3 cursor-pointer transition-all ${survivingId === r.id ? 'border-primary bg-primary/5' : 'border-border hover:border-primary/40'}`}
                    onClick={() => setSurvivingId(r.id)}
                  >
                    <div className="flex items-center justify-between mb-2">
                      <span className="text-xs font-mono text-muted-foreground">
                        {r.id < 0 ? 'Destination' : `#${r.rowNumber}`}
                      </span>
                      {survivingId === r.id && (
                        <Badge className="text-[9px] bg-primary text-primary-foreground border-0">Survivor</Badge>
                      )}
                      {r.id < 0 && survivingId !== r.id && (
                        <Badge variant="outline" className="text-[9px] border-blue-300 text-blue-700">Dest. System</Badge>
                      )}
                      {r.id > 0 && r.id === candidates.primaryRecord.id && survivingId !== r.id && (
                        <Badge variant="outline" className="text-[9px]">Primary</Badge>
                      )}
                    </div>
                    <div className="space-y-1">
                      {Object.entries(dataObj(r)).slice(0, 4).map(([k, v]) => (
                        <div key={k} className="text-[10px]">
                          <span className="text-muted-foreground">{k}: </span>
                          <span className="font-mono">{String(v ?? '')}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {candidates.matchingFields.length > 0 && (
              <div>
                <p className="text-xs font-semibold text-green-700 uppercase tracking-wide mb-2">Matching Evidence</p>
                <div className="flex flex-wrap gap-2">
                  {candidates.matchingFields.map((f, i) => (
                    <span key={i} className="inline-flex items-center gap-1 text-[11px] bg-green-50 border border-green-200 rounded px-2 py-1">
                      <span className="font-medium">{f.field}:</span>
                      <span className="font-mono">{f.value}</span>
                      <span className="text-green-600 text-[9px]">({f.matchType})</span>
                    </span>
                  ))}
                </div>
                {(() => {
                  const firstMatch = (candidates.primaryRecord.duplicateEvidence as Array<{ explanation?: string }> | null)?.[0];
                  return firstMatch?.explanation ? (
                    <p className="text-[11px] text-muted-foreground italic mt-2">{firstMatch.explanation}</p>
                  ) : null;
                })()}
              </div>
            )}

            {candidates.conflictingFields.length > 0 && (
              <div>
                <p className="text-xs font-semibold text-amber-700 uppercase tracking-wide mb-2">Conflicting Fields — Choose Which Value to Keep</p>
                <div className="space-y-3">
                  {candidates.conflictingFields.map(cf => {
                    const primaryVal = cf.primaryValue;
                    const allOptions = [
                      { recordId: candidates.primaryRecord.id, value: primaryVal, label: `Record #${candidates.primaryRecord.rowNumber}` },
                      ...cf.candidateValues.map(cv => {
                        const rec = candidates.candidateRecords.find(r => r.id === cv.recordId);
                        return { recordId: cv.recordId, value: cv.value, label: `Record #${rec?.rowNumber ?? cv.recordId}` };
                      }),
                    ];
                    const selected = fieldSelections[cf.field];
                    return (
                      <div key={cf.field} className="bg-amber-50/60 border border-amber-200 rounded p-3">
                        <p className="text-xs font-bold mb-2">{cf.field}</p>
                        <div className="flex flex-wrap gap-2">
                          {allOptions.map(opt => (
                            <button
                              key={opt.recordId}
                              className={`text-[11px] rounded border px-3 py-1.5 cursor-pointer transition-all ${
                                selected?.fromRecordId === opt.recordId
                                  ? 'border-primary bg-primary text-primary-foreground font-medium'
                                  : 'border-border bg-white hover:border-primary/60'
                              }`}
                              onClick={() => setFieldSelections(prev => ({
                                ...prev,
                                [cf.field]: { value: opt.value, fromRecordId: opt.recordId },
                              }))}
                            >
                              <span className="text-[9px] opacity-70 block">{opt.label}</span>
                              <span className="font-mono">{opt.value || '(empty)'}</span>
                            </button>
                          ))}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            <div className="space-y-1.5">
              <Label className="text-xs font-semibold">Reason for Consolidation <span className="text-destructive">*</span></Label>
              <Textarea
                placeholder="Explain why these records are duplicates and how you determined which to keep…"
                value={reason}
                onChange={e => setReason(e.target.value)}
                rows={3}
              />
            </div>

            <div className="bg-blue-50 border border-blue-200 rounded p-3">
              <p className="text-[11px] text-blue-700">
                <strong>Lineage preserved:</strong> Original source records are never deleted. Merged records retain <code>consolidated</code> status for audit traceability.
              </p>
            </div>
          </div>
        )}

        {candidates && step === 'compare' && (
          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
            <Button
              onClick={() => {
                if (!reason.trim()) { toast.error('Please provide a reason for consolidation'); return; }
                const mergedIds = [candidates.primaryRecord, ...candidates.candidateRecords]
                  .filter(r => r.id !== survivingId)
                  .map(r => r.id);
                finalizeMutation.mutate({
                  projectId,
                  survivingRecordId: survivingId,
                  mergedRecordIds: mergedIds,
                  fieldSelections,
                  reason,
                });
              }}
              disabled={finalizeMutation.isPending || !reason.trim()}
            >
              {finalizeMutation.isPending ? <><Loader2 className="h-4 w-4 animate-spin" /> Consolidating…</> : <><CheckSquare className="h-4 w-4" /> Finalize Consolidation</>}
            </Button>
          </DialogFooter>
        )}
      </DialogContent>
    </Dialog>
  );
}

// ---- Discuss Dialog ----

interface DiscussDialogProps {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  projectId: number;
  record: MigrationRecord;
  linkedRecordIds?: number[];
  onDone: () => void;
}

function DiscussDialog({ open, onOpenChange, projectId, record, linkedRecordIds, onDone }: DiscussDialogProps) {
  const [question, setQuestion] = useState('');
  const [stakeholderId, setStakeholderId] = useState<string>('');
  const [notes, setNotes] = useState('');
  const [notifyByEmail, setNotifyByEmail] = useState(false);
  const [selectedParticipants, setSelectedParticipants] = useState<number[]>([]);
  const [showAddStakeholder, setShowAddStakeholder] = useState(false);
  const [newSH, setNewSH] = useState({ name: '', email: '', organization: 'source', role: 'Other' });

  const stakeholdersQuery = useGetStakeholders({ projectId });
  const stakeholders = stakeholdersQuery.data ?? [];

  const appUsersQuery = useGetAppUsers({ projectId });
  const appUsers = appUsersQuery.data ?? [];

  const isAppUserStakeholder = (() => {
    const sh = stakeholders.find(s => s.id === Number(stakeholderId));
    return sh?.isAppUser ?? false;
  })();

  // Build a suggested question from rule violations
  const ruleFindings = (record.destinationRuleFindings as Array<{ field: string; rule: string; explanation: string; sourceValue?: string | null }> | null) ?? [];

  const buildSuggestedQuestion = () => {
    if (ruleFindings.length > 0) {
      const f = ruleFindings[0];
      const fieldLabel = f.field || 'a required field';
      const prob = f.explanation || 'is missing or invalid';
      const org = 'the source team';
      if (f.rule === 'required' || prob.toLowerCase().includes('missing') || prob.toLowerCase().includes('required')) {
        return `Can ${org} provide the ${fieldLabel} for this record, or confirm that no valid ${fieldLabel} is available? Context: ${prob}`;
      }
      return `Can ${org} clarify the ${fieldLabel} for this record? The current value appears to be invalid — ${prob}`;
    }
    return record.suggestedQuestion ?? '';
  };

  const suggestedQuestion = buildSuggestedQuestion();

  const createSHMutation = useServerMutation(
    createStakeholder as (input: { projectId: number; name: string; email: string; organization: string; role: string; isAppUser?: boolean }) => Promise<MigrationStakeholder>,
    {
    onSuccess: (sh) => {
      toast.success('Stakeholder added');
      stakeholdersQuery.refetch?.();
      setStakeholderId(String((sh as MigrationStakeholder).id));
      setShowAddStakeholder(false);
      setNewSH({ name: '', email: '', organization: 'source', role: 'Other' });
    },
    onError: () => toast.error('Failed to add stakeholder'),
  });

  const addMutation = useServerMutation(addDiscussion, {
    onSuccess: () => {
      const count = (linkedRecordIds?.length ?? 0) + 1;
      toast.success(count > 1
        ? `Discussion created and linked to ${count} records.`
        : 'Discussion created. Record moved to In Discussion.');
      onDone();
      onOpenChange(false);
    },
    onError: () => toast.error('Failed to create discussion'),
  });

  const statusMutation = useServerMutation(updateRecordStatus, {
    onError: () => toast.error('Failed to update record status'),
  });

  const handleSubmit = () => {
    if (!question.trim()) { toast.error('Please enter a question or topic for discussion'); return; }
    if (!stakeholderId) { toast.error('Please select a responsible stakeholder'); return; }
    // Only update primary record status if no bulk linking (linked records handled in server)
    if (!linkedRecordIds || linkedRecordIds.length === 0) {
      statusMutation.mutate({ id: record.id, projectId, status: 'discussing' });
    }
    const selectedSH = stakeholders.find(s => s.id === Number(stakeholderId));
    addMutation.mutate({
      recordId: record.id,
      projectId,
      content: question,
      title: question.slice(0, 120),
      stakeholderId: Number(stakeholderId),
      stakeholder: selectedSH ? `${selectedSH.name} <${selectedSH.email}>` : undefined,
      notes: notes.trim() || undefined,
      linkedRecordIds: linkedRecordIds ?? [],
      participants: selectedParticipants,
      notifyByEmail: notifyByEmail,
    });
  };

  const resetForm = () => {
    setQuestion(suggestedQuestion);
    setStakeholderId('');
    setNotes('');
    setNotifyByEmail(false);
    setSelectedParticipants([]);
    setShowAddStakeholder(false);
  };

  useEffect(() => {
    if (open) resetForm();
  }, [open]);

  const isPending = addMutation.isPending || statusMutation.isPending;
  const bulkCount = (linkedRecordIds?.length ?? 0) + 1;
  const isBulk = bulkCount > 1;

  return (
    <Dialog open={open} onOpenChange={v => { if (!v) onOpenChange(false); }}>
      <DialogContent className="sm:max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <MessageSquare className="h-5 w-5 text-blue-600" />
            {isBulk ? 'Create Shared Discussion' : 'Create Clarification Discussion'}
          </DialogTitle>
          <DialogDescription>
            {isBulk
              ? `This discussion will be linked to ${bulkCount} selected records. The stakeholder can respond once while all records remain tracked.`
              : `Record #${record.rowNumber} — assign a stakeholder and ask a question.`}
          </DialogDescription>
        </DialogHeader>

        {/* Bulk context banner */}
        {isBulk && (
          <div className="bg-blue-50 border border-blue-200 rounded-lg p-3 flex items-start gap-2">
            <Layers className="h-4 w-4 text-blue-600 mt-0.5 shrink-0" />
            <div>
              <p className="text-xs font-semibold text-blue-800">Bulk Discussion — {bulkCount} Records</p>
              <p className="text-[11px] text-blue-700 mt-0.5">
                One discussion, one stakeholder response. Each record individually audited and linked.
              </p>
            </div>
          </div>
        )}

        <div className="space-y-4 py-2">
          {/* Suggested question from rule violations */}
          {suggestedQuestion && (
            <div className="bg-blue-50 border border-blue-200 rounded p-3">
              <p className="text-[10px] font-semibold text-blue-700 uppercase tracking-wide mb-1.5">
                {ruleFindings.length > 0 ? 'Suggested Question from Rule Violation' : 'AI-Suggested Question'}
              </p>
              <p className="text-xs italic text-blue-800 leading-snug mb-2">&ldquo;{suggestedQuestion}&rdquo;</p>
              <Button
                size="sm" variant="ghost"
                className="text-[10px] h-6 px-2 text-blue-700 cursor-pointer"
                onClick={() => setQuestion(suggestedQuestion)}
              >
                Use this question
              </Button>
            </div>
          )}

          <div className="space-y-1.5">
            <Label className="text-xs font-semibold">Question or Topic <span className="text-destructive">*</span></Label>
            <Textarea
              placeholder="What needs clarification? What should be resolved before deciding on this record?"
              value={question}
              onChange={e => setQuestion(e.target.value)}
              rows={3}
            />
          </div>

          {/* Stakeholder selector */}
          <div className="space-y-1.5">
            <div className="flex items-center justify-between">
              <Label className="text-xs font-semibold">Responsible Stakeholder <span className="text-destructive">*</span></Label>
              <Button
                variant="ghost"
                size="sm"
                className="h-6 text-[10px] px-2 gap-1 text-primary cursor-pointer"
                onClick={() => setShowAddStakeholder(!showAddStakeholder)}
              >
                <UserPlus className="h-3 w-3" />
                Add new
              </Button>
            </div>

            {stakeholders.length === 0 && !showAddStakeholder ? (
              <div className="bg-muted/60 border border-border rounded p-3 text-center">
                <p className="text-xs text-muted-foreground">No stakeholders yet.</p>
                <Button
                  variant="ghost"
                  size="sm"
                  className="text-xs mt-1 text-primary cursor-pointer"
                  onClick={() => setShowAddStakeholder(true)}
                >
                  <UserPlus className="h-3.5 w-3.5" /> Add a stakeholder
                </Button>
              </div>
            ) : (
              <select
                className="w-full h-9 px-3 text-xs border border-input rounded-md bg-background focus:outline-none focus:ring-1 focus:ring-ring cursor-pointer"
                value={stakeholderId}
                onChange={e => setStakeholderId(e.target.value)}
              >
                <option value="">Select a stakeholder…</option>
                {stakeholders.map(s => (
                  <option key={s.id} value={String(s.id)}>
                    {s.name} — {s.role} ({s.organization}){s.isAppUser ? ' ✓ App user' : ''}
                  </option>
                ))}
              </select>
            )}

            {/* Selected stakeholder detail */}
            {stakeholderId && (() => {
              const sh = stakeholders.find(s => s.id === Number(stakeholderId));
              if (!sh) return null;
              return (
                <div className="flex items-center gap-2 text-xs bg-muted/40 rounded px-3 py-2">
                  <div className="h-6 w-6 rounded-full bg-primary/10 flex items-center justify-center text-primary text-[10px] font-bold shrink-0">
                    {sh.name[0]}
                  </div>
                  <div className="flex-1">
                    <span className="font-medium">{sh.name}</span>
                    <span className="text-muted-foreground ml-2">{sh.email}</span>
                  </div>
                  {sh.isAppUser
                    ? <UserCheck className="h-3.5 w-3.5 text-green-600" />
                    : <Mail className="h-3.5 w-3.5 text-blue-500" />}
                </div>
              );
            })()}

            {/* Inline add stakeholder form */}
            {showAddStakeholder && (
              <div className="border border-primary/20 rounded-lg p-3 bg-primary/5 space-y-3">
                <p className="text-[10px] font-semibold text-primary uppercase tracking-wide">Quick-add Stakeholder</p>
                <div className="grid grid-cols-2 gap-2">
                  <Input
                    placeholder="Full name *"
                    className="h-8 text-xs"
                    value={newSH.name}
                    onChange={e => setNewSH(p => ({ ...p, name: e.target.value }))}
                  />
                  <Input
                    placeholder="Email *"
                    type="email"
                    className="h-8 text-xs"
                    value={newSH.email}
                    onChange={e => setNewSH(p => ({ ...p, email: e.target.value }))}
                  />
                  <select
                    className="h-8 px-2 text-xs border border-input rounded-md bg-background cursor-pointer"
                    value={newSH.organization}
                    onChange={e => setNewSH(p => ({ ...p, organization: e.target.value }))}
                  >
                    <option value="source">Source Org</option>
                    <option value="destination">Destination Org</option>
                  </select>
                  <select
                    className="h-8 px-2 text-xs border border-input rounded-md bg-background cursor-pointer"
                    value={newSH.role}
                    onChange={e => setNewSH(p => ({ ...p, role: e.target.value }))}
                  >
                    {['Project Manager','Legal','Accounting','Product','HR','Data','Technical','Executive','Other'].map(r => (
                      <option key={r} value={r}>{r}</option>
                    ))}
                  </select>
                </div>
                <div className="flex gap-2">
                  <Button
                    size="sm"
                    className="text-[10px] h-7"
                    disabled={!newSH.name.trim() || !newSH.email.trim() || createSHMutation.isPending}
                    onClick={() => createSHMutation.mutate({ projectId, ...newSH })}
                  >
                    {createSHMutation.isPending ? <Loader2 className="h-3 w-3 animate-spin" /> : <UserPlus className="h-3 w-3" />}
                    Save
                  </Button>
                  <Button size="sm" variant="ghost" className="text-[10px] h-7" onClick={() => setShowAddStakeholder(false)}>Cancel</Button>
                </div>
              </div>
            )}
          </div>

          {/* Participants — app users to notify in-app */}
          {appUsers.length > 0 && (
            <div className="space-y-1.5">
              <Label className="text-xs font-semibold">Notify Participants <span className="text-muted-foreground font-normal">(app users)</span></Label>
              <div className="flex flex-wrap gap-1.5">
                {appUsers.map(u => {
                  const name = [u.firstName, u.lastName].filter(Boolean).join(' ') || u.email;
                  const isSelected = selectedParticipants.includes(u.id);
                  return (
                    <button
                      key={u.id}
                      type="button"
                      onClick={() => setSelectedParticipants(prev =>
                        isSelected ? prev.filter(id => id !== u.id) : [...prev, u.id]
                      )}
                      className={`text-[11px] rounded-full border px-2.5 py-1 cursor-pointer transition-all ${
                        isSelected
                          ? 'bg-primary text-primary-foreground border-primary'
                          : 'border-border bg-background hover:border-primary/60'
                      }`}
                    >
                      {name}
                    </button>
                  );
                })}
              </div>
              <p className="text-[10px] text-muted-foreground">Selected participants receive an in-app notification.</p>
            </div>
          )}

          {/* Email notification opt-in */}
          <div className="border border-border rounded-lg p-3">
            <label className="flex items-start gap-2.5 cursor-pointer">
              <input
                type="checkbox"
                checked={notifyByEmail}
                onChange={e => setNotifyByEmail(e.target.checked)}
                className="mt-0.5 w-4 h-4 cursor-pointer"
              />
              <div>
                <p className="text-xs font-medium">Also notify participants by email</p>
                <p className="text-[11px] text-muted-foreground mt-0.5">
                  {isAppUserStakeholder
                    ? 'The responsible stakeholder has a MergeFlow account and will receive an in-app notification. Check this to also send an email.'
                    : 'External stakeholders without a MergeFlow account are always notified by email.'}
                </p>
              </div>
            </label>
          </div>

          <div className="space-y-1.5">
            <Label className="text-xs font-semibold">Internal Notes <span className="text-muted-foreground font-normal">(optional)</span></Label>
            <Textarea
              placeholder="Internal context, what you've already investigated, relevant background…"
              value={notes}
              onChange={e => setNotes(e.target.value)}
              rows={2}
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button
            onClick={handleSubmit}
            disabled={isPending || !question.trim() || !stakeholderId}
          >
            {isPending ? <><Loader2 className="h-4 w-4 animate-spin" /> Creating…</> : <><MessageSquare className="h-4 w-4" /> Create Discussion</>}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ---- Resolve Discussion Dialog ----

interface ResolveDiscussionDialogProps {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  projectId: number;
  record: MigrationRecord;
  discussionId: number;
  onDone: () => void;
  ruleFindings?: RuleFinding[];
  migrationValues?: MigrationValue[];
  onMigrationValueSaved?: (updated: MigrationRecord) => void;
}

function ResolveDiscussionDialog({ open, onOpenChange, projectId, record, discussionId, onDone, ruleFindings = [], migrationValues = [], onMigrationValueSaved }: ResolveDiscussionDialogProps) {
  const [resolution, setResolution] = useState('');
  const [nextDisposition, setNextDisposition] = useState<'pending' | 'approved' | 'excluded'>('pending');
  const [applyField, setApplyField] = useState('');
  const [applyValue, setApplyValue] = useState('');
  const [applyReason, setApplyReason] = useState('');
  const [showApplySection, setShowApplySection] = useState(ruleFindings.length > 0);

  const ruleFindings2 = ruleFindings.length > 0 ? ruleFindings : (record.destinationRuleFindings as RuleFinding[] | null) ?? [];
  const canApprove = ruleFindings2.length === 0;

  // Allowed values for chosen field
  const chosenFinding = ruleFindings2.find(f => f.field === applyField);
  const allowedValuesForApply: string[] = [];
  if (chosenFinding?.rule === 'allowed_values' && chosenFinding.expectedValue) {
    allowedValuesForApply.push(...chosenFinding.expectedValue.split(' | ').map(v => v.trim()).filter(Boolean));
  }

  const [isSaving, setIsSaving] = useState(false);

  const handleResolve = async () => {
    setIsSaving(true);
    try {
      // If applying a migration value, do that first
      if (showApplySection && applyField && applyValue.trim() && applyReason.trim()) {
        const result = await setMigrationValue({
          recordId: record.id,
          projectId,
          fieldName: applyField,
          migrationValue: applyValue,
          reason: applyReason,
          discussionId,
        });
        if (onMigrationValueSaved) onMigrationValueSaved((result as { record: MigrationRecord }).record);
        toast.success('Migration value applied and record revalidated.');
      }
      // Then resolve the discussion
      await resolveDiscussion({ discussionId, projectId, recordId: record.id, resolution, nextDisposition });
      const msg = nextDisposition === 'approved'
        ? 'Discussion resolved and record approved.'
        : nextDisposition === 'excluded'
          ? 'Discussion resolved and record excluded.'
          : 'Discussion resolved. Record returned to Review.';
      toast.success(msg);
      onDone();
      onOpenChange(false);
    } catch (err) {
      captureError(err as Error);
      toast.error('Failed to resolve discussion');
    } finally {
      setIsSaving(false);
    }
  };

  const isPending = isSaving;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <CheckCircle2 className="h-5 w-5 text-green-600" />
            Resolve Discussion
          </DialogTitle>
          <DialogDescription>Record the outcome and decide what happens to this record next.</DialogDescription>
        </DialogHeader>
        <div className="space-y-4 py-2">
          <div className="space-y-1.5">
            <Label className="text-xs font-semibold">Resolution <span className="text-destructive">*</span></Label>
            <Textarea
              placeholder="What was learned? What was decided? What information was provided?"
              value={resolution}
              onChange={e => setResolution(e.target.value)}
              rows={4}
            />
          </div>

          {/* Apply to Migration Value section */}
          {ruleFindings2.length > 0 && (
            <div className="border border-blue-200 rounded-lg overflow-hidden">
              <button
                className="w-full flex items-center justify-between px-3 py-2.5 bg-blue-50 text-left cursor-pointer hover:bg-blue-100/60"
                onClick={() => setShowApplySection(v => !v)}
              >
                <div className="flex items-center gap-2">
                  <ArrowRight className="h-4 w-4 text-blue-600" />
                  <span className="text-xs font-semibold text-blue-800">Apply resolution to migration value</span>
                  {showApplySection && applyField && applyValue && (
                    <Badge className="text-[9px] bg-blue-100 text-blue-700 border-blue-300 border">Will apply</Badge>
                  )}
                </div>
                {showApplySection ? <ChevronDown className="h-4 w-4 text-blue-600" /> : <ChevronRight className="h-4 w-4 text-blue-600" />}
              </button>
              {showApplySection && (
                <div className="p-3 space-y-3">
                  <p className="text-[11px] text-blue-700">Set the migration value for the affected field. The original source data is preserved.</p>
                  <div className="space-y-1">
                    <label className="text-[10px] font-semibold uppercase tracking-wide">Field to update</label>
                    <select
                      className="w-full h-8 px-2 text-xs border border-input rounded-md bg-background"
                      value={applyField}
                      onChange={e => { setApplyField(e.target.value); setApplyValue(''); }}
                    >
                      <option value="">Select field…</option>
                      {ruleFindings2.map(f => (
                        <option key={f.field} value={f.field}>{f.field} ({f.rule.replace(/_/g, ' ')})</option>
                      ))}
                    </select>
                  </div>
                  {applyField && (
                    <>
                      <div className="space-y-1">
                        <label className="text-[10px] font-semibold uppercase tracking-wide">New migration value</label>
                        {allowedValuesForApply.length > 0 ? (
                          <select
                            className="w-full h-8 px-2 text-xs border border-input rounded-md bg-background"
                            value={applyValue}
                            onChange={e => setApplyValue(e.target.value)}
                          >
                            <option value="">Select value…</option>
                            {allowedValuesForApply.map(v => <option key={v} value={v}>{v}</option>)}
                          </select>
                        ) : (
                          <Input
                            className="h-8 text-xs"
                            placeholder="Enter corrected value…"
                            value={applyValue}
                            onChange={e => setApplyValue(e.target.value)}
                          />
                        )}
                      </div>
                      <div className="space-y-1">
                        <label className="text-[10px] font-semibold uppercase tracking-wide">Reason</label>
                        <Input
                          className="h-8 text-xs"
                          placeholder="e.g. Stakeholder confirmed this value"
                          value={applyReason}
                          onChange={e => setApplyReason(e.target.value)}
                        />
                      </div>
                    </>
                  )}
                </div>
              )}
            </div>
          )}

          <div className="space-y-2">
            <Label className="text-xs font-semibold">After resolving, return record to:</Label>
            <div className="grid grid-cols-3 gap-2">
              <button
                className={`rounded-lg border-2 p-2.5 text-center cursor-pointer transition-all ${
                  nextDisposition === 'pending' ? 'border-primary bg-primary/5' : 'border-border hover:border-primary/40'
                }`}
                onClick={() => setNextDisposition('pending')}
              >
                <CircleDot className="h-4 w-4 mx-auto mb-1 text-amber-600" />
                <p className="text-[10px] font-semibold">Review</p>
                <p className="text-[9px] text-muted-foreground">Decide later</p>
              </button>
              <button
                disabled={!canApprove && !(showApplySection && applyField && applyValue)}
                className={`rounded-lg border-2 p-2.5 text-center cursor-pointer transition-all ${
                  nextDisposition === 'approved' ? 'border-green-500 bg-green-50' : 'border-border hover:border-green-300'
                } disabled:opacity-40 disabled:cursor-not-allowed`}
                onClick={() => (canApprove || (showApplySection && applyField && applyValue)) && setNextDisposition('approved')}
              >
                <Check className="h-4 w-4 mx-auto mb-1 text-green-600" />
                <p className="text-[10px] font-semibold">Approve</p>
                <p className="text-[9px] text-muted-foreground">{canApprove ? 'Migrate record' : 'After fixing value'}</p>
              </button>
              <button
                className={`rounded-lg border-2 p-2.5 text-center cursor-pointer transition-all ${
                  nextDisposition === 'excluded' ? 'border-red-400 bg-red-50' : 'border-border hover:border-red-300'
                }`}
                onClick={() => setNextDisposition('excluded')}
              >
                <X className="h-4 w-4 mx-auto mb-1 text-red-600" />
                <p className="text-[10px] font-semibold">Exclude</p>
                <p className="text-[9px] text-muted-foreground">Don't migrate</p>
              </button>
            </div>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button
            onClick={handleResolve}
            disabled={isPending || !resolution.trim()}
            className={nextDisposition === 'approved' ? 'bg-green-600 hover:bg-green-700' : nextDisposition === 'excluded' ? 'bg-destructive hover:bg-destructive/90' : ''}
          >
            {isPending
              ? <><Loader2 className="h-4 w-4 animate-spin" /> Saving…</>
              : nextDisposition === 'approved' ? <><Check className="h-4 w-4" /> Resolve &amp; Approve</>
              : nextDisposition === 'excluded' ? <><X className="h-4 w-4" /> Resolve &amp; Exclude</>
              : <><CheckCircle2 className="h-4 w-4" /> Resolve &amp; Return to Review</>}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ---- Discussion Thread Component ----

interface DiscussionThreadProps {
  discussion: {
    id: number;
    title: string | null;
    content: string;
    stakeholder: string | null;
    notes: string | null;
    discussionStatus: string;
    resolution: string | null;
    resolvedAt: Date | null;
    createdById: number;
    createdAt: Date | null;
    responses?: Array<{
      id: number;
      content: string;
      isInternal: boolean;
      createdAt: Date | null;
      createdById: number;
    }>;
  };
  record: MigrationRecord;
  projectId: number;
  isFinalStatus: (s: string) => boolean;
  onResolve: () => void;
  onRefetch: () => void;
  appUsers: Array<{ id: number; email: string; firstName: string | null; lastName: string | null }>;
  ruleFindings: RuleFinding[];
  migrationValues: MigrationValue[];
  onMigrationValueSaved: (updated: MigrationRecord) => void;
}

function DiscussionThread({ discussion: d, record, projectId, isFinalStatus, onResolve, onRefetch, appUsers, ruleFindings, migrationValues, onMigrationValueSaved }: DiscussionThreadProps) {
  const [responseText, setResponseText] = useState('');
  const [isInternal, setIsInternal] = useState(false);
  const [showReplyBox, setShowReplyBox] = useState(false);
  const [showApplyPanel, setShowApplyPanel] = useState(false);
  const [applyField, setApplyField] = useState('');
  const [applyValue, setApplyValue] = useState('');
  const [applyReason, setApplyReason] = useState('');

  // Helper to get user display name
  const getUserName = (userId: number) => {
    const u = appUsers.find(u => u.id === userId);
    if (!u) return `User #${userId}`;
    return u.firstName ? `${u.firstName} ${u.lastName ?? ''}`.trim() : u.email;
  };

  const formatTime = (dt: Date | null) => {
    if (!dt) return '';
    const d = dt instanceof Date ? dt : new Date(dt);
    return d.toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
  };

  const responseMutation = useServerMutation(addDiscussionResponse, {
    onSuccess: () => {
      toast.success('Response added');
      setResponseText('');
      setShowReplyBox(false);
      onRefetch();
    },
    onError: () => toast.error('Failed to add response'),
  });

  const applyMvMutation = useServerMutation(setMigrationValue, {
    onSuccess: (result) => {
      toast.success(`Migration value applied and record revalidated.`);
      onMigrationValueSaved((result as { record: MigrationRecord }).record);
      setShowApplyPanel(false);
      setApplyValue('');
      setApplyReason('');
    },
    onError: () => toast.error('Failed to apply migration value'),
  });

  const isResolved = d.discussionStatus === 'resolved';

  // Determine allowed values for chosen field
  const chosenFinding = ruleFindings.find(f => f.field === applyField);
  const allowedValuesForApply: string[] = [];
  if (chosenFinding?.rule === 'allowed_values' && chosenFinding.expectedValue) {
    allowedValuesForApply.push(...chosenFinding.expectedValue.split(' | ').map(v => v.trim()).filter(Boolean));
  }

  return (
    <div className={`rounded-lg border ${
      isResolved ? 'bg-green-50/60 border-green-200' : 'bg-white/80 border-blue-200'
    }`}>
      {/* Header */}
      <div className="flex items-start justify-between gap-2 p-3 border-b border-inherit">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <p className="text-xs font-semibold">{d.title ?? d.content}</p>
            <Badge className={`text-[9px] border-0 shrink-0 ${
              isResolved ? 'bg-green-100 text-green-700' : 'bg-blue-100 text-blue-700'
            }`}>
              {isResolved ? 'Resolved' : 'Open'}
            </Badge>
          </div>
          <div className="flex items-center gap-3 mt-1 flex-wrap">
            {d.stakeholder && (
              <div className="flex items-center gap-1 text-[10px] text-muted-foreground">
                <Users className="h-3 w-3" />
                <span>{d.stakeholder}</span>
              </div>
            )}
            <div className="flex items-center gap-1 text-[10px] text-muted-foreground">
              <span>Started by {getUserName(d.createdById)}</span>
              {d.createdAt && <span>· {formatTime(d.createdAt)}</span>}
            </div>
          </div>
        </div>
      </div>

      {/* Original question */}
      <div className="px-3 py-2">
        <p className="text-xs text-foreground leading-snug">{d.content}</p>
        {d.notes && (
          <div className="mt-2 flex items-start gap-1.5 text-[10px] text-muted-foreground bg-muted/50 rounded px-2 py-1.5">
            <StickyNote className="h-3 w-3 mt-0.5 shrink-0" />
            <span>{d.notes}</span>
          </div>
        )}
      </div>

      {/* Responses */}
      {d.responses && d.responses.length > 0 && (
        <div className="mx-3 mb-3 space-y-2">
          {d.responses.map(r => (
            <div key={r.id} className={`rounded border px-3 py-2 ${
              r.isInternal ? 'bg-amber-50/60 border-amber-200' : 'bg-blue-50/40 border-blue-200'
            }`}>
              <div className="flex items-center gap-2 mb-1">
                {r.isInternal
                  ? <Badge className="text-[8px] bg-amber-100 text-amber-700 border-0">Internal note</Badge>
                  : <Badge className="text-[8px] bg-blue-100 text-blue-700 border-0">Response</Badge>
                }
                <span className="text-[10px] text-muted-foreground">
                  {getUserName(r.createdById)}
                  {r.createdAt && <> · {formatTime(r.createdAt)}</>}
                </span>
              </div>
              <p className="text-xs text-foreground leading-snug">{r.content}</p>
            </div>
          ))}
        </div>
      )}

      {/* Resolution */}
      {d.resolution && (
        <div className="mx-3 mb-3 bg-green-100 border border-green-300 rounded-lg p-3">
          <div className="flex items-center gap-1.5 mb-1.5">
            <CheckCircle2 className="h-4 w-4 text-green-600" />
            <p className="text-[10px] font-bold text-green-700 uppercase tracking-wide">Resolution</p>
          </div>
          <p className="text-xs text-foreground font-medium leading-snug">{d.resolution}</p>
        </div>
      )}

      {/* Apply to Migration Value panel */}
      {!isResolved && ruleFindings.length > 0 && (
        <div className="mx-3 mb-2">
          <button
            className="flex items-center gap-1.5 text-[11px] text-blue-700 font-semibold hover:underline cursor-pointer"
            onClick={() => setShowApplyPanel(v => !v)}
          >
            <ArrowRight className="h-3.5 w-3.5" />
            Apply response to migration value
            {showApplyPanel ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
          </button>
          {showApplyPanel && (
            <div className="mt-2 border border-blue-200 rounded-lg bg-blue-50/60 p-3 space-y-3">
              <p className="text-[10px] text-blue-700">Apply the clarified value directly to the migration. The original source value is preserved.</p>
              <div className="space-y-1">
                <label className="text-[10px] font-semibold uppercase tracking-wide">Field with violation</label>
                <select
                  className="w-full h-8 px-2 text-xs border border-input rounded-md bg-background"
                  value={applyField}
                  onChange={e => { setApplyField(e.target.value); setApplyValue(''); }}
                >
                  <option value="">Select field…</option>
                  {ruleFindings.map(f => (
                    <option key={f.field} value={f.field}>{f.field}</option>
                  ))}
                </select>
              </div>
              {applyField && (
                <div className="space-y-1">
                  <label className="text-[10px] font-semibold uppercase tracking-wide">Migration value</label>
                  {allowedValuesForApply.length > 0 ? (
                    <select
                      className="w-full h-8 px-2 text-xs border border-input rounded-md bg-background"
                      value={applyValue}
                      onChange={e => setApplyValue(e.target.value)}
                    >
                      <option value="">Select value…</option>
                      {allowedValuesForApply.map(v => <option key={v} value={v}>{v}</option>)}
                    </select>
                  ) : (
                    <Input
                      className="h-8 text-xs"
                      placeholder="Enter corrected value…"
                      value={applyValue}
                      onChange={e => setApplyValue(e.target.value)}
                    />
                  )}
                </div>
              )}
              {applyField && (
                <div className="space-y-1">
                  <label className="text-[10px] font-semibold uppercase tracking-wide">Reason</label>
                  <Input
                    className="h-8 text-xs"
                    placeholder="e.g. Stakeholder confirmed this value"
                    value={applyReason}
                    onChange={e => setApplyReason(e.target.value)}
                  />
                </div>
              )}
              {applyField && (
                <Button
                  size="sm"
                  className="text-xs bg-blue-600 hover:bg-blue-700 gap-1 w-full"
                  disabled={!applyValue.trim() || !applyReason.trim() || applyMvMutation.isPending}
                  onClick={() => applyMvMutation.mutate({
                    recordId: record.id,
                    projectId,
                    fieldName: applyField,
                    migrationValue: applyValue,
                    reason: applyReason,
                    discussionId: d.id,
                  })}
                >
                  {applyMvMutation.isPending
                    ? <><Loader2 className="h-3.5 w-3.5 animate-spin" /> Saving…</>
                    : <><Check className="h-3.5 w-3.5" /> Save and validate</>
                  }
                </Button>
              )}
            </div>
          )}
        </div>
      )}

      {/* Actions */}
      {!isResolved && (
        <div className="px-3 pb-3 flex items-center gap-2 flex-wrap">
          <Button
            size="sm"
            variant="outline"
            className="text-[10px] h-6 px-2 text-blue-700 border-blue-300 hover:bg-blue-50 cursor-pointer"
            onClick={() => setShowReplyBox(!showReplyBox)}
          >
            <Send className="h-3 w-3" /> Add Response
          </Button>
          {!isFinalStatus(record.status) && (
            <Button
              size="sm"
              variant="outline"
              className="text-[10px] h-6 px-2 text-green-700 border-green-300 hover:bg-green-50 cursor-pointer"
              onClick={onResolve}
            >
              <CheckCircle2 className="h-3 w-3" /> Resolve
            </Button>
          )}
        </div>
      )}

      {/* Reply box */}
      {showReplyBox && (
        <div className="px-3 pb-3 space-y-2">
          <Textarea
            placeholder="Type your response…"
            value={responseText}
            onChange={e => setResponseText(e.target.value)}
            rows={2}
            className="text-xs"
          />
          <div className="flex items-center justify-between">
            <label className="flex items-center gap-1.5 text-[10px] text-muted-foreground cursor-pointer">
              <input
                type="checkbox"
                checked={isInternal}
                onChange={e => setIsInternal(e.target.checked)}
                className="w-3.5 h-3.5"
              />
              Internal note (not shared with stakeholder)
            </label>
            <div className="flex gap-2">
              <Button size="sm" variant="ghost" className="text-[10px] h-7" onClick={() => setShowReplyBox(false)}>Cancel</Button>
              <Button
                size="sm"
                className="text-[10px] h-7"
                disabled={!responseText.trim() || responseMutation.isPending}
                onClick={() => responseMutation.mutate({
                  discussionId: d.id,
                  projectId,
                  recordId: record.id,
                  content: responseText,
                  isInternal,
                })}
              >
                {responseMutation.isPending ? <Loader2 className="h-3 w-3 animate-spin" /> : <Send className="h-3 w-3" />}
                Send
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ---- Change Disposition Dialog ----

interface ChangeDispositionDialogProps {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  projectId: number;
  record: MigrationRecord;
  onDone: () => void;
}

function ChangeDispositionDialog({ open, onOpenChange, projectId, record, onDone }: ChangeDispositionDialogProps) {
  const [reason, setReason] = useState('');

  const changeMutation = useServerMutation(changeDisposition, {
    onSuccess: () => {
      toast.success('Decision reversed. Record returned to pending review. Original decision preserved in audit log.');
      onDone();
      onOpenChange(false);
    },
    onError: () => toast.error('Failed to change disposition'),
  });

  return (
    <Dialog open={open} onOpenChange={v => { if (v) setReason(''); onOpenChange(v); }}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <RotateCcw className="h-5 w-5 text-amber-600" />
            Change Previous Decision
          </DialogTitle>
          <DialogDescription>
            The previous decision for Record #{record.rowNumber} (<strong>{STATUS_CONFIG[record.status]?.label}</strong>) will be preserved in the audit log. A reason is required.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3 py-2">
          <div className="bg-amber-50 border border-amber-200 rounded p-3">
            <p className="text-[11px] text-amber-700">
              The original decision is <strong>never erased</strong>. This appends a new audit event and returns the record to pending.
            </p>
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs font-semibold">Reason for Reversing <span className="text-destructive">*</span></Label>
            <Textarea
              placeholder="Why is this decision being reversed? What new information changed the outcome?"
              value={reason}
              onChange={e => setReason(e.target.value)}
              rows={3}
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button
            variant="destructive"
            onClick={() => changeMutation.mutate({ id: record.id, projectId, reason })}
            disabled={changeMutation.isPending || !reason.trim()}
          >
            {changeMutation.isPending ? <><Loader2 className="h-4 w-4 animate-spin" /> Processing…</> : <><RotateCcw className="h-4 w-4" /> Reverse Decision</>}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ---- Sidebar Queue Button ----

function QueueButton({
  label, icon, count, isActive, onClick,
}: {
  label: string;
  icon: React.ReactNode;
  count: number;
  isActive: boolean;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className={`w-full flex items-center justify-between px-2 py-1.5 rounded text-xs cursor-pointer transition-colors ${
        isActive
          ? 'bg-primary text-primary-foreground font-medium'
          : 'text-sidebar-foreground hover:bg-sidebar-accent'
      }`}
    >
      <span className="flex items-center gap-1.5 min-w-0">
        <span className="shrink-0">{icon}</span>
        <span className="truncate">{label}</span>
      </span>
      {count > 0 && (
        <span className={`shrink-0 text-[10px] font-bold rounded-full px-1.5 py-0.5 min-w-[20px] text-center ${
          isActive ? 'bg-primary-foreground/20 text-primary-foreground' : 'bg-muted text-muted-foreground'
        }`}>
          {count}
        </span>
      )}
    </button>
  );
}

// ---- Main Page ----

export default function ReviewWorkspace() {
  const { id } = useParams();
  const projectId = Number(id);

  usePageTitle('Review | MergeFlow');

  const [activeQueue, setActiveQueue] = useState<QueueFilter>('ready_for_approval');
  const [search, setSearch] = useState('');
  const [selectedRecord, setSelectedRecord] = useState<MigrationRecord | null>(null);
  const [bulkSelected, setBulkSelected] = useState<Set<number>>(new Set());
  const [page, setPage] = useState(0);
  const [showBulkConfirm, setShowBulkConfirm] = useState(false);
  const [showBulkExclude, setShowBulkExclude] = useState(false);
  const [showBulkDiscuss, setShowBulkDiscuss] = useState(false);
  const [bulkExcludeReason, setBulkExcludeReason] = useState('');
  const [showConsolidate, setShowConsolidate] = useState(false);
  const [showDiscuss, setShowDiscuss] = useState(false);
  const [showChangeDisposition, setShowChangeDisposition] = useState(false);
  const [resolveDiscussionId, setResolveDiscussionId] = useState<number | null>(null);
  const [aiAnalyzingId, setAiAnalyzingId] = useState<number | null>(null);
  const [aiExpandedDetail, setAiExpandedDetail] = useState(false);
  // Bulk AI analyze state
  const [bulkAiProgress, setBulkAiProgress] = useState<{ done: number; total: number } | null>(null);
  const [bulkAiRunning, setBulkAiRunning] = useState(false);
  const [showFinalizeDialog, setShowFinalizeDialog] = useState(false);
  const [showReopenDialog, setShowReopenDialog] = useState(false);

  // Queues that support bulk selection
  const BULK_SELECTABLE_QUEUES: QueueFilter[] = ['ready_for_approval', 'rule_violations', 'needs_discussion', 'recommended_exclusions', 'pending'];
  const queueSupportsBulk = BULK_SELECTABLE_QUEUES.includes(activeQueue);

  const navigate = useNavigate();

  // Read URL params on mount to restore filter state from deep links
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const queueParam = params.get('queue');
    const statusParam = params.get('status');
    const allQueueKeys = ALL_QUEUES.map(q => q.key);
    if (queueParam && allQueueKeys.includes(queueParam as QueueFilter)) {
      setActiveQueue(queueParam as QueueFilter);
    } else if (statusParam && allQueueKeys.includes(statusParam as QueueFilter)) {
      setActiveQueue(statusParam as QueueFilter);
    }
  }, []);

  const projectQuery = useGetProject({ id: projectId });
  const project = projectQuery.data;

  const countsQuery = useGetQueueCounts({ projectId });
  const counts = countsQuery.data;

  const checklistQuery = useGetFinalizationChecklist({ projectId });
  const checklist = checklistQuery.data;

  const appUsersQuery = useGetAppUsers({ projectId });

  const recordsQuery = useGetRecords({
    projectId,
    queue: activeQueue,
    limit: 50,
    offset: page * 50,
  });
  const { data: recordsData } = recordsQuery;
  const records = recordsData?.records ?? [];
  const total = recordsData?.total ?? 0;

  const filtered = useMemo(() => {
    if (!search.trim()) return records;
    const q = search.toLowerCase();
    return records.filter(r => {
      const dataStr = JSON.stringify(r.data).toLowerCase();
      return dataStr.includes(q) || r.aiIssueSummary?.toLowerCase().includes(q);
    });
  }, [records, search]);

  // Workflow progress summary
  const workflowSummary = useMemo(() => {
    if (!checklist) return null;
    return {
      tracked: checklist.tracked,
      total: checklist.total,
      finalized: checklist.finalized,
      unresolved: checklist.unresolved,
      discussing: counts?.discussing ?? 0,
      pending: (counts?.pending ?? 0) - (counts?.discussing ?? 0),
    };
  }, [checklist, counts]);

  const updateMutation = useServerMutation(updateRecordStatus, {
    query: recordsQuery,
    optimistic: (prev, input) => {
      if (!prev) return prev;
      return { ...prev, records: prev.records.map(r => r.id === input.id ? { ...r, status: input.status } : r) };
    },
    onSuccess: () => {
      countsQuery.refetch?.();
      toast.success('Record updated');
    },
    onError: () => toast.error('Failed to update record'),
  });

  const bulkMutation = useServerMutation(bulkUpdateRecordStatus, {
    onSuccess: (result) => {
      recordsQuery.refetch?.();
      countsQuery.refetch?.();
      setBulkSelected(new Set());
      setShowBulkConfirm(false);
      toast.success(`${result.updatedCount} records approved`);
    },
    onError: () => toast.error('Bulk approval failed'),
  });

  const analyzeMutation = useServerMutation(analyzeRecords, {
    onSuccess: (r) => {
      recordsQuery.refetch?.();
      countsQuery.refetch?.();
      const failMsg = r.failed > 0 ? ` · ${r.failed} AI failure(s)` : '';
      toast.success(`Analyzed ${r.analyzed} records${failMsg}`);
      if (r.requirementsWarning) toast.warning(r.requirementsWarning);
      if (r.duplicateWarning) toast.warning(r.duplicateWarning);
    },
    onError: () => toast.error('Analysis failed'),
  });

  const bulkExcludeMutation = useServerMutation(bulkExcludeRecords, {
    onSuccess: (result) => {
      recordsQuery.refetch?.();
      countsQuery.refetch?.();
      setBulkSelected(new Set());
      setShowBulkExclude(false);
      setBulkExcludeReason('');
      toast.success(`${result.updatedCount} records excluded`);
    },
    onError: () => toast.error('Bulk exclusion failed'),
  });

  const handleStatus = (status: MigrationRecord['status'], note?: string) => {
    if (!selectedRecord) return;
    if (selectedRecord.status === status) {
      toast.info(`Record is already ${STATUS_CONFIG[status]?.label ?? status}`);
      return;
    }
    updateMutation.mutate({ id: selectedRecord.id, projectId, status, reviewNote: note });
    setSelectedRecord(prev => prev ? { ...prev, status } : null);
  };

  const handleQueueChange = (q: QueueFilter) => {
    setActiveQueue(q);
    setPage(0);
    setSearch('');
    setBulkSelected(new Set());
    setSelectedRecord(null);
    setAiExpandedDetail(false);
    navigate(`/projects/${projectId}/review?queue=${q}`);
  };

  const toggleBulkSelect = (id: number) => {
    setBulkSelected(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const selectAllFiltered = () => {
    // Select all non-finalized records in the current filtered view
    setBulkSelected(new Set(filtered.filter(r => !isFinalStatus(r.status)).map(r => r.id)));
  };

  const handleBulkAnalyzeAI = async () => {
    const ids = Array.from(bulkSelected);
    setBulkAiRunning(true);
    setBulkAiProgress({ done: 0, total: ids.length });
    let done = 0;
    for (const recId of ids) {
      try {
        await analyzeRecordAI({ recordId: recId, projectId });
        done++;
        setBulkAiProgress({ done, total: ids.length });
      } catch (err) {
        captureError(err as Error);
        done++;
        setBulkAiProgress({ done, total: ids.length });
      }
    }
    setBulkAiRunning(false);
    setBulkAiProgress(null);
    recordsQuery.refetch?.();
    countsQuery.refetch?.();
    toast.success(`AI analysis complete for ${ids.length} records`);
  };

  const dataObj = (record: MigrationRecord) => record.data as Record<string, unknown>;

  const getRecordLabel = (record: MigrationRecord) => {
    const vals = Object.values(dataObj(record)).slice(0, 2).map(v => String(v)).filter(Boolean);
    return vals.join(' · ') || `Record #${record.rowNumber}`;
  };

  const isFinalStatus = (status: string) => ['approved', 'excluded', 'consolidated'].includes(status);

  const getCount = (key: string): number => {
    if (!counts) return 0;
    return (counts as unknown as Record<string, number>)[key] ?? 0;
  };

  return (
    <div className="min-h-screen bg-background">
      <AppHeader projectId={projectId} projectName={project?.name} />
      {/* Finalization banner for already-finalized projects */}
      {project?.status === 'finalized' && (
        <div className="flex items-center gap-3 px-5 py-2.5 bg-primary text-primary-foreground text-sm">
          <Lock className="h-4 w-4 shrink-0" />
          <span className="font-semibold">Migration Finalized</span>
          <span className="opacity-80 text-xs">
            Finalized on {project.finalizedAt ? new Date(project.finalizedAt).toLocaleDateString() : 'unknown date'}. This migration is locked. All records and decisions are preserved in the audit log.
          </span>
          <Button
            size="sm"
            variant="outline"
            className="ml-auto shrink-0 text-primary-foreground border-primary-foreground/40 hover:bg-primary-foreground/10 text-xs gap-1"
            onClick={() => setShowReopenDialog(true)}
          >
            <Unlock className="h-3.5 w-3.5" /> Reopen Migration
          </Button>
          <Button
            size="sm"
            className="shrink-0 bg-secondary text-secondary-foreground hover:bg-secondary/80 text-xs gap-1"
            onClick={() => navigate(`/projects/${projectId}`)}
          >
            <ArrowRight className="h-3.5 w-3.5" /> View Dashboard
          </Button>
        </div>
      )}
      <main className="max-w-full px-0 py-0 pb-0">
        <div className="flex" style={{ height: 'calc(100vh - 58px)' }}>

          {/* Queue Sidebar */}
          <div className="w-52 shrink-0 border-r border-border bg-sidebar flex flex-col">
            <div className="p-3 border-b border-sidebar-border">
              <div className="relative">
                <Search className="absolute left-2.5 top-2 h-3.5 w-3.5 text-muted-foreground" />
                <Input
                  placeholder="Search..."
                  className="pl-8 h-8 text-xs"
                  value={search}
                  onChange={e => { setSearch(e.target.value); setPage(0); }}
                />
              </div>
            </div>

            <div className="flex-1 overflow-y-auto py-2 space-y-0.5">
              {/* ANALYSIS QUEUES */}
              <div className="px-2 pb-1">
                <p className="text-[9px] font-semibold text-muted-foreground uppercase tracking-widest px-2 py-1">Analysis Queues</p>
                {ANALYSIS_QUEUES.map(q => (
                  <QueueButton
                    key={q.key}
                    label={q.label}
                    icon={q.icon}
                    count={getCount(q.countKey)}
                    isActive={activeQueue === q.key}
                    onClick={() => handleQueueChange(q.key)}
                  />
                ))}
              </div>

              {/* WORKFLOW */}
              <div className="px-2 pt-2 border-t border-sidebar-border">
                <p className="text-[9px] font-semibold text-muted-foreground uppercase tracking-widest px-2 py-1">Workflow</p>
                {WORKFLOW_QUEUES.map(q => (
                  <QueueButton
                    key={q.key}
                    label={q.label}
                    icon={q.icon}
                    count={getCount(q.countKey)}
                    isActive={activeQueue === q.key}
                    onClick={() => handleQueueChange(q.key)}
                  />
                ))}
              </div>

              {/* DISPOSITIONS */}
              <div className="px-2 pt-2 border-t border-sidebar-border">
                <p className="text-[9px] font-semibold text-muted-foreground uppercase tracking-widest px-2 py-1">Dispositions</p>
                {DISPOSITION_QUEUES.map(q => (
                  <QueueButton
                    key={q.key}
                    label={q.label}
                    icon={q.icon}
                    count={getCount(q.countKey)}
                    isActive={activeQueue === q.key}
                    onClick={() => handleQueueChange(q.key)}
                  />
                ))}
                <QueueButton
                  label="All Records"
                  icon={<ListFilter className="h-3.5 w-3.5" />}
                  count={getCount('all')}
                  isActive={activeQueue === 'all'}
                  onClick={() => handleQueueChange('all')}
                />
              </div>
            </div>

            <div className="p-3 border-t border-sidebar-border space-y-1.5">
              <Button
                variant="outline"
                size="sm"
                className="w-full text-xs gap-1.5"
                onClick={() => analyzeMutation.mutate({ projectId })}
                disabled={analyzeMutation.isPending}
              >
                <Sparkles className="h-3.5 w-3.5" />
                {analyzeMutation.isPending ? 'Analyzing…' : 'Run Analysis'}
              </Button>
              {project?.status !== 'finalized' && (
                <Button
                  size="sm"
                  className={`w-full text-xs gap-1.5 ${
                    checklist?.canFinalize
                      ? 'bg-secondary text-secondary-foreground hover:bg-secondary/80'
                      : ''
                  }`}
                  variant={checklist?.canFinalize ? 'default' : 'outline'}
                  onClick={() => setShowFinalizeDialog(true)}
                >
                  <Flag className="h-3.5 w-3.5" />
                  {checklist?.canFinalize ? 'Complete Migration' : 'Finish Review'}
                </Button>
              )}
              {project?.status === 'finalized' && (
                <Button
                  size="sm"
                  variant="outline"
                  className="w-full text-xs gap-1.5"
                  onClick={() => navigate(`/projects/${projectId}`)}
                >
                  <ArrowRight className="h-3.5 w-3.5" /> Dashboard
                </Button>
              )}
            </div>
          </div>

          {/* Record List */}
          <div className="w-72 shrink-0 border-r border-border flex flex-col bg-background">
            {/* Progress bar */}
            {workflowSummary && workflowSummary.total > 0 && (
              <div className="px-3 py-2 border-b border-border bg-muted/30">
                <div className="flex items-center gap-1.5 text-[10px] text-muted-foreground flex-wrap">
                  <span className="text-foreground font-medium">{workflowSummary.tracked} of {workflowSummary.total} tracked</span>
                  <span>·</span>
                  <span className="text-green-700 font-medium">{workflowSummary.finalized} finalized</span>
                  {workflowSummary.unresolved > 0 && (
                    <>
                      <span>·</span>
                      <span className="text-amber-700 font-medium">{workflowSummary.unresolved} unresolved</span>
                    </>
                  )}
                </div>
                <div className="mt-1.5 h-1.5 bg-border rounded-full overflow-hidden">
                  <div
                    className="h-full bg-green-500 rounded-full transition-all"
                    style={{ width: `${workflowSummary.total > 0 ? (workflowSummary.finalized / workflowSummary.total) * 100 : 0}%` }}
                  />
                </div>
                {workflowSummary.unresolved === 0 && workflowSummary.total > 0 && (
                  <div className="flex items-center gap-1 mt-1.5 text-[10px] text-green-700 font-semibold">
                    <CheckCircle2 className="h-3 w-3" />
                    Review complete
                  </div>
                )}
              </div>
            )}

            <div className="p-3 border-b border-border flex items-center justify-between">
              <div>
                <p className="text-xs font-semibold">
                  {ALL_QUEUES.find(q => q.key === activeQueue)?.label ?? 'Records'}
                </p>
                <p className="text-[10px] text-muted-foreground">{total} record{total !== 1 ? 's' : ''}</p>
              </div>
                          {queueSupportsBulk && filtered.length > 0 && (
                <Button
                  size="sm"
                  variant="outline"
                  className="text-[10px] h-7 px-2 gap-1"
                  onClick={selectAllFiltered}
                >
                  <Check className="h-3 w-3" /> Select All
                </Button>
              )}
            </div>

            {bulkSelected.size > 0 && (
              <div className="px-3 py-2 bg-primary/5 border-b border-primary/20 space-y-1.5">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-medium text-primary">{bulkSelected.size} selected</span>
                  <Button
                    size="sm"
                    variant="ghost"
                    className="text-[10px] h-6 px-1.5"
                    onClick={() => setBulkSelected(new Set())}
                  >
                    Clear
                  </Button>
                </div>
                <div className="flex flex-col gap-1">
                  {/* Approve: only in ready_for_approval, only records with no rule violations */}
                  {activeQueue === 'ready_for_approval' && (() => {
                    const selectedRecords = filtered.filter(r => bulkSelected.has(r.id));
                    const allBlocked = selectedRecords.some(r => (r.destinationRuleFindings as unknown[])?.length > 0);
                    return (
                      <Button
                        size="sm"
                        className="text-[10px] h-6 px-2 bg-green-600 hover:bg-green-700 w-full"
                        onClick={() => {
                          if (allBlocked) {
                            toast.error('Some selected records have rule violations. Remove them from selection before approving.');
                            return;
                          }
                          setShowBulkConfirm(true);
                        }}
                        disabled={bulkMutation.isPending || bulkAiRunning}
                      >
                        <Check className="h-3 w-3" /> Approve {bulkSelected.size}
                      </Button>
                    );
                  })()}
                  <div className="flex gap-1">
                    {/* Discuss: all bulk-selectable queues */}
                    <Button
                      size="sm"
                      variant="outline"
                      className="text-[10px] h-6 px-2 flex-1 gap-1 text-blue-700 border-blue-300 hover:bg-blue-50"
                      onClick={() => {
                        if (!selectedRecord) {
                          // Use first selected record as primary
                          const firstId = Array.from(bulkSelected)[0];
                          const firstRec = filtered.find(r => r.id === firstId);
                          if (firstRec) setSelectedRecord(firstRec);
                        }
                        setShowBulkDiscuss(true);
                      }}
                      disabled={bulkAiRunning}
                    >
                      <MessageSquare className="h-3 w-3" /> Discuss
                    </Button>
                    {/* Exclude: all bulk-selectable queues */}
                    <Button
                      size="sm"
                      variant="outline"
                      className="text-[10px] h-6 px-2 flex-1 gap-1 text-red-700 border-red-300 hover:bg-red-50"
                      onClick={() => setShowBulkExclude(true)}
                      disabled={bulkAiRunning || bulkExcludeMutation.isPending}
                    >
                      <X className="h-3 w-3" /> Exclude
                    </Button>
                  </div>
                  <Button
                    size="sm"
                    variant="outline"
                    className="text-[10px] h-6 px-2 w-full gap-1 text-purple-700 border-purple-300 hover:bg-purple-50"
                    onClick={handleBulkAnalyzeAI}
                    disabled={bulkAiRunning || bulkMutation.isPending}
                  >
                    {bulkAiRunning && bulkAiProgress ? (
                      <><Loader2 className="h-3 w-3 animate-spin" /> {bulkAiProgress.done}/{bulkAiProgress.total}</>
                    ) : (
                      <><Brain className="h-3 w-3" /> Check selected for contextual issues</>
                    )}
                  </Button>
                </div>
              </div>
            )}

            <div className="flex-1 overflow-y-auto">
              {filtered.length === 0 ? (
                <div className="flex flex-col items-center justify-center h-full text-center px-4 py-8">
                  <CheckCircle2 className="h-8 w-8 text-muted-foreground/30 mb-2" />
                  <p className="text-xs text-muted-foreground">
                    {search ? 'No matching records' : 'No records in this queue'}
                  </p>
                </div>
              ) : (
                <div className="divide-y divide-border/50">
                  {filtered.map((record) => {
                    const disp = record.recommendedDisposition as RecommendedDisposition | null;
                    const dispConfig = disp ? DISPOSITION_CONFIG[disp] : null;
                    const isSelected = selectedRecord?.id === record.id;
                    const isBulkSelected = bulkSelected.has(record.id);
                    const ruleFindings = (record.destinationRuleFindings as RuleFinding[] | null) ?? [];
                    const hasViolation = ruleFindings.length > 0;

                    return (
                      <div
                        key={record.id}
                        className={`flex items-start gap-2 p-3 cursor-pointer transition-colors ${
                          isSelected
                            ? 'bg-primary/8 border-l-2 border-l-primary'
                            : 'hover:bg-muted/40 border-l-2 border-l-transparent'
                        }`}
                        onClick={() => { setSelectedRecord(record); setAiExpandedDetail(false); }}
                      >
                        {(queueSupportsBulk || bulkSelected.size > 0) && !isFinalStatus(record.status) && (
                          <div
                            className="mt-0.5 shrink-0"
                            onClick={e => { e.stopPropagation(); toggleBulkSelect(record.id); }}
                          >
                            <div className={`w-4 h-4 rounded border flex items-center justify-center cursor-pointer transition-colors ${
                              isBulkSelected ? 'bg-primary border-primary' : 'border-border hover:border-primary'
                            }`}>
                              {isBulkSelected && <Check className="h-2.5 w-2.5 text-primary-foreground" />}
                            </div>
                          </div>
                        )}
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center justify-between mb-0.5">
                            <span className="text-[10px] font-mono text-muted-foreground">#{record.rowNumber}</span>
                            <Badge className={`text-[9px] px-1 h-4 border-0 ${STATUS_CONFIG[record.status]?.color ?? ''}`}>
                              {STATUS_CONFIG[record.status]?.label}
                            </Badge>
                          </div>
                          <p className="text-xs font-medium line-clamp-1">{getRecordLabel(record)}</p>
                          <div className="flex items-center gap-1.5 mt-0.5 flex-wrap">
                            {hasViolation && (
                              <span className="inline-flex items-center gap-0.5 text-[9px] bg-red-100 text-red-700 rounded px-1 py-0.5">
                                <ShieldAlert className="h-2.5 w-2.5" /> {ruleFindings.length} violation{ruleFindings.length !== 1 ? 's' : ''}
                              </span>
                            )}
                            {disp && dispConfig && !hasViolation && (
                              <div className="flex items-center gap-0.5">
                                {dispConfig.icon}
                                <span className="text-[9px] text-muted-foreground">{dispConfig.label}</span>
                              </div>
                            )}
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>

            {total > 50 && (
              <div className="p-2 border-t border-border flex items-center justify-between">
                <Button variant="ghost" size="sm" className="text-[10px] h-7" disabled={page === 0} onClick={() => setPage(p => p - 1)}>Previous</Button>
                <span className="text-[10px] text-muted-foreground">{page * 50 + 1}–{Math.min((page + 1) * 50, total)} of {total}</span>
                <Button variant="ghost" size="sm" className="text-[10px] h-7" disabled={(page + 1) * 50 >= total} onClick={() => setPage(p => p + 1)}>Next</Button>
              </div>
            )}
          </div>

          {/* Record Detail */}
          <div className="flex-1 min-w-0 flex flex-col overflow-y-auto bg-background">
            {!selectedRecord ? (
              <div className="flex-1 flex items-center justify-center text-muted-foreground">
                <div className="text-center">
                  <CircleDot className="h-12 w-12 mx-auto mb-3 opacity-20" />
                  <p className="text-sm font-medium">Select a record to review</p>
                  <p className="text-xs text-muted-foreground mt-1">
                    {ALL_QUEUES.find(q => q.key === activeQueue)?.label}
                  </p>
                </div>
              </div>
            ) : (
              <RecordDetail
                record={selectedRecord}
                projectId={projectId}
                isFinalStatus={isFinalStatus}
                aiAnalyzingId={aiAnalyzingId}
                setAiAnalyzingId={setAiAnalyzingId}
                aiExpandedDetail={aiExpandedDetail}
                setAiExpandedDetail={setAiExpandedDetail}
                onStatus={handleStatus}
                onDiscuss={() => setShowDiscuss(true)}
                onConsolidate={() => setShowConsolidate(true)}
                onChangeDisposition={() => setShowChangeDisposition(true)}
                onResolveDiscussion={setResolveDiscussionId}
                onRecordUpdated={(updated) => setSelectedRecord(updated)}
                onRefetch={() => { recordsQuery.refetch?.(); countsQuery.refetch?.(); }}
                updateIsPending={updateMutation.isPending}
                appUsers={appUsersQuery.data ?? []}
              />
            )}
          </div>
        </div>
      </main>

      {/* Dialogs */}
      {selectedRecord && (
        <ConsolidationDialog
          open={showConsolidate}
          onOpenChange={setShowConsolidate}
          projectId={projectId}
          record={selectedRecord}
          onDone={() => {
            recordsQuery.refetch?.();
            countsQuery.refetch?.();
            setSelectedRecord(null);
          }}
        />
      )}

      {selectedRecord && (
        <DiscussDialog
          open={showDiscuss}
          onOpenChange={setShowDiscuss}
          projectId={projectId}
          record={selectedRecord}
          onDone={() => {
            recordsQuery.refetch?.();
            countsQuery.refetch?.();
            setSelectedRecord(prev => prev ? { ...prev, status: 'discussing' } : null);
          }}
        />
      )}

      {selectedRecord && resolveDiscussionId !== null && (
        <ResolveDiscussionDialog
          open={resolveDiscussionId !== null}
          onOpenChange={open => { if (!open) setResolveDiscussionId(null); }}
          projectId={projectId}
          record={selectedRecord}
          discussionId={resolveDiscussionId}
          onDone={() => {
            recordsQuery.refetch?.();
            setResolveDiscussionId(null);
          }}
          ruleFindings={(selectedRecord.destinationRuleFindings as any[]) ?? []}
          onMigrationValueSaved={(updated) => setSelectedRecord(updated)}
        />
      )}

      {selectedRecord && (
        <ChangeDispositionDialog
          open={showChangeDisposition}
          onOpenChange={setShowChangeDisposition}
          projectId={projectId}
          record={selectedRecord}
          onDone={() => {
            recordsQuery.refetch?.();
            countsQuery.refetch?.();
            setSelectedRecord(prev => prev ? { ...prev, status: 'pending' } : null);
          }}
        />
      )}

      <Dialog open={showBulkConfirm} onOpenChange={setShowBulkConfirm}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>Confirm Bulk Approval</DialogTitle>
          </DialogHeader>
          <div className="py-3">
            <p className="text-sm text-muted-foreground">
              You are about to approve <strong>{bulkSelected.size} records</strong> recommended as ready for migration. Each approval is individually logged in the audit trail.
            </p>
            <p className="text-xs text-muted-foreground mt-2">
              Already-approved records will be skipped automatically.
            </p>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowBulkConfirm(false)}>Cancel</Button>
            <Button
              className="bg-green-600 hover:bg-green-700"
              onClick={() => bulkMutation.mutate({ ids: Array.from(bulkSelected), projectId, status: 'approved' })}
              disabled={bulkMutation.isPending}
            >
              <Check className="h-4 w-4" /> Approve {bulkSelected.size} Records
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Bulk Exclude Dialog */}
      <Dialog open={showBulkExclude} onOpenChange={v => { setShowBulkExclude(v); if (!v) setBulkExcludeReason(''); }}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <X className="h-5 w-5 text-destructive" />
              Exclude {bulkSelected.size} Records
            </DialogTitle>
            <DialogDescription>Provide a shared reason for excluding all selected records. Each exclusion is individually logged in the audit trail.</DialogDescription>
          </DialogHeader>
          <div className="py-3 space-y-3">
            <div className="space-y-1.5">
              <Label className="text-xs font-semibold">Reason for Exclusion <span className="text-destructive">*</span></Label>
              <Textarea
                placeholder="Why are these records being excluded from migration?"
                value={bulkExcludeReason}
                onChange={e => setBulkExcludeReason(e.target.value)}
                rows={3}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowBulkExclude(false)}>Cancel</Button>
            <Button
              variant="destructive"
              disabled={!bulkExcludeReason.trim() || bulkExcludeMutation.isPending}
              onClick={() => bulkExcludeMutation.mutate({ ids: Array.from(bulkSelected), projectId, reason: bulkExcludeReason })}
            >
              {bulkExcludeMutation.isPending ? <><Loader2 className="h-4 w-4 animate-spin" /> Excluding…</> : <><X className="h-4 w-4" /> Exclude {bulkSelected.size} Records</>}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Bulk Discuss Dialog */}
      {showBulkDiscuss && (() => {
        const allIds = Array.from(bulkSelected);
        const primaryId = allIds[0];
        const primaryRecord = filtered.find(r => r.id === primaryId) ?? selectedRecord;
        const otherIds = allIds.slice(1);
        if (!primaryRecord) return null;
        return (
          <DiscussDialog
            open={showBulkDiscuss}
            onOpenChange={v => setShowBulkDiscuss(v)}
            projectId={projectId}
            record={primaryRecord}
            linkedRecordIds={otherIds}
            onDone={() => {
              recordsQuery.refetch?.();
              countsQuery.refetch?.();
              setBulkSelected(new Set());
              setShowBulkDiscuss(false);
            }}
          />
        );
      })()}

      {/* Finalization Dialog */}
      <FinalizationDialog
        open={showFinalizeDialog}
        onOpenChange={setShowFinalizeDialog}
        projectId={projectId}
        checklist={checklist ?? null}
        onFinalized={() => {
          projectQuery.refetch?.();
          checklistQuery.refetch?.();
          setShowFinalizeDialog(false);
        }}
      />

      {/* Reopen Dialog */}
      <ReopenDialog
        open={showReopenDialog}
        onOpenChange={setShowReopenDialog}
        projectId={projectId}
        onReopened={() => {
          projectQuery.refetch?.();
          checklistQuery.refetch?.();
          setShowReopenDialog(false);
        }}
      />
    </div>
  );
}

// ---- Remediation Panel ----

interface RemediationPanelProps {
  finding: RuleFinding;
  record: MigrationRecord;
  projectId: number;
  migrationValues: MigrationValue[];
  onSaved: (updated: MigrationRecord) => void;
}

function RemediationPanel({ finding, record, projectId, migrationValues, onSaved }: RemediationPanelProps) {
  const existingMv = migrationValues.find(mv => mv.fieldName === finding.field);
  const [open, setOpen] = useState(false);
  const [value, setValue] = useState(existingMv?.migrationValue ?? '');
  const [reason, setReason] = useState('');

  // Reset when finding or existing value changes
  useEffect(() => {
    setValue(existingMv?.migrationValue ?? '');
    setReason('');
  }, [finding.field, existingMv?.migrationValue]);

  const saveMutation = useServerMutation(setMigrationValue, {
    onSuccess: (result) => {
      toast.success(`Migration value saved. Record revalidated.`);
      onSaved((result as { record: MigrationRecord }).record);
      setOpen(false);
      setReason('');
    },
    onError: () => toast.error('Failed to save migration value'),
  });

  // Parse allowed values from expectedValue (e.g. "Active | Inactive")
  const allowedValues: string[] = [];
  if (finding.rule === 'allowed_values' && finding.expectedValue) {
    allowedValues.push(...finding.expectedValue.split(' | ').map(v => v.trim()).filter(Boolean));
  }

  const inputType = finding.rule === 'email_format' ? 'email'
    : finding.rule === 'data_type' && finding.expectedValue?.includes('date') ? 'date'
    : 'text';

  const hasChanged = existingMv !== undefined;

  return (
    <div className="border-t border-blue-200 bg-blue-50/40">
      <button
        className="w-full flex items-center justify-between px-3 py-2 text-left cursor-pointer hover:bg-blue-50/80 transition-colors"
        onClick={() => setOpen(o => !o)}
      >
        <div className="flex items-center gap-2">
          <ArrowRight className="h-3.5 w-3.5 text-blue-600 shrink-0" />
          <span className="text-xs font-semibold text-blue-800">Set migration value</span>
          {hasChanged && (
            <Badge className="text-[9px] bg-blue-100 text-blue-700 border-blue-300 border">Changed for migration</Badge>
          )}
        </div>
        {open ? <ChevronDown className="h-3.5 w-3.5 text-blue-600" /> : <ChevronRight className="h-3.5 w-3.5 text-blue-600" />}
      </button>

      {open && (
        <div className="px-3 pb-3 space-y-3">
          {/* Show original vs migration value when changed */}
          {hasChanged && (
            <div className="flex items-center gap-3 text-[11px] bg-white/70 border border-blue-200 rounded p-2">
              <div>
                <p className="text-[9px] font-bold text-muted-foreground uppercase tracking-wide mb-0.5">Original source value</p>
                <p className="font-mono">{existingMv.originalSourceValue || <span className="italic text-muted-foreground">Missing</span>}</p>
              </div>
              <ArrowRight className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
              <div>
                <p className="text-[9px] font-bold text-blue-600 uppercase tracking-wide mb-0.5">Current migration value</p>
                <p className="font-mono font-semibold text-blue-800">{existingMv.migrationValue || '(empty)'}</p>
              </div>
            </div>
          )}

          <div className="space-y-1">
            <label className="text-[10px] font-semibold text-foreground uppercase tracking-wide">
              Migration value for <span className="text-blue-700">{finding.field}</span>
            </label>
            {allowedValues.length > 0 ? (
              <select
                className="w-full h-9 px-3 text-sm border border-input rounded-md bg-background focus:outline-none focus:ring-1 focus:ring-ring"
                value={value}
                onChange={e => setValue(e.target.value)}
              >
                <option value="">Select a value…</option>
                {allowedValues.map(v => (
                  <option key={v} value={v}>{v}</option>
                ))}
              </select>
            ) : (
              <Input
                type={inputType}
                placeholder={`Enter ${finding.field}…`}
                value={value}
                onChange={e => setValue(e.target.value)}
                className="text-sm"
              />
            )}
          </div>

          <div className="space-y-1">
            <label className="text-[10px] font-semibold text-foreground uppercase tracking-wide">Reason for change <span className="text-destructive">*</span></label>
            <Input
              placeholder="Why is this value being changed for migration?"
              value={reason}
              onChange={e => setReason(e.target.value)}
              className="text-sm"
            />
          </div>

          <div className="flex gap-2">
            <Button
              size="sm"
              className="text-xs bg-blue-600 hover:bg-blue-700 gap-1"
              disabled={!value.trim() || !reason.trim() || saveMutation.isPending}
              onClick={() => saveMutation.mutate({
                recordId: record.id,
                projectId,
                fieldName: finding.field,
                migrationValue: value,
                reason,
              })}
            >
              {saveMutation.isPending ? <><Loader2 className="h-3.5 w-3.5 animate-spin" /> Saving…</> : <><Check className="h-3.5 w-3.5" /> Save and validate</>}
            </Button>
            <Button size="sm" variant="ghost" className="text-xs" onClick={() => setOpen(false)}>Cancel</Button>
          </div>
        </div>
      )}
    </div>
  );
}

// ---- Record Detail Panel (extracted for clarity) ----

interface RecordDetailProps {
  record: MigrationRecord;
  projectId: number;
  isFinalStatus: (s: string) => boolean;
  aiAnalyzingId: number | null;
  setAiAnalyzingId: (id: number | null) => void;
  aiExpandedDetail: boolean;
  setAiExpandedDetail: (v: boolean) => void;
  onStatus: (s: MigrationRecord['status']) => void;
  onDiscuss: () => void;
  onConsolidate: () => void;
  onChangeDisposition: () => void;
  onResolveDiscussion: (id: number) => void;
  onRecordUpdated: (r: MigrationRecord) => void;
  onRefetch: () => void;
  updateIsPending: boolean;
  appUsers: Array<{ id: number; email: string; firstName: string | null; lastName: string | null }>;
}

function RecordDetail({
  record,
  projectId,
  isFinalStatus,
  aiAnalyzingId,
  setAiAnalyzingId,
  aiExpandedDetail,
  setAiExpandedDetail,
  onStatus,
  onDiscuss,
  onConsolidate,
  onChangeDisposition,
  onResolveDiscussion,
  onRecordUpdated,
  onRefetch,
  updateIsPending,
  appUsers,
}: RecordDetailProps) {
  const dataObj = (r: MigrationRecord) => r.data as Record<string, unknown>;

  // Load full record (with discussions) and migration values
  const recordDetailQuery = useGetRecord({ id: record.id });
  const fullRecord = recordDetailQuery.data;
  const migrationValuesQuery = useGetMigrationValues({ recordId: record.id });
  const migrationValues: MigrationValue[] = migrationValuesQuery.data ?? [];

  const ruleFindings: RuleFinding[] = (record.destinationRuleFindings as RuleFinding[] | null) ??
    ((record.validationErrors as Array<{ field: string; message: string }> | null)?.map(e => ({
      findingSource: 'destination_rule' as const,
      field: e.field,
      rule: '',
      sourceValue: null,
      expectedValue: null,
      explanation: e.message,
      severity: 'error' as const,
      status: 'open' as const,
    })) ?? []);

  const dupMatches = record.duplicateEvidence as DuplicateMatch[] | null;
  const aiFindings = (record.aiAnalysisFindings as AIFinding[] | null) ?? [];
  const disp = record.recommendedDisposition as RecommendedDisposition | null;
  const dispConfig = disp ? DISPOSITION_CONFIG[disp] : null;

  // Top 1 AI finding for preview (most actionable)
  const AI_PREVIEW_COUNT = 1;
  const topAiFindings = aiFindings.slice(0, AI_PREVIEW_COUNT);
  const hiddenAiFindings = aiFindings.slice(AI_PREVIEW_COUNT);

  // Detect "AI has run but found nothing" — aiReasoning set + no warning findings
  const aiHasRun = !!(record.aiReasoning);
  const aiFoundNothing = aiHasRun && !aiFindings.some(f => f.severity === 'warning');

  const getRecordLabel = (r: MigrationRecord) => {
    const vals = Object.values(dataObj(r)).slice(0, 2).map(v => String(v)).filter(Boolean);
    return vals.join(' · ') || `Record #${r.rowNumber}`;
  };

  const discussions = (fullRecord as any)?.discussions as Array<{
    id: number;
    title: string | null;
    content: string;
    stakeholder: string | null;
    notes: string | null;
    discussionStatus: string;
    resolution: string | null;
    resolvedAt: Date | null;
    createdById: number;
    createdAt: Date | null;
    responses: Array<{ id: number; content: string; isInternal: boolean; createdAt: Date | null; createdById: number }>;
  }> | undefined;

  const blockingCount = ruleFindings.length + (dupMatches?.length ?? 0);

  return (
    <div className="p-5 space-y-4 max-w-3xl">
      {/* Header */}
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="text-base font-bold flex items-center gap-2 flex-wrap">
            Record #{record.rowNumber}
            <Badge className={`text-[9px] px-1.5 h-4 border-0 ${STATUS_CONFIG[record.status]?.color}`}>
              {STATUS_CONFIG[record.status]?.label}
            </Badge>
          </h2>
          <p className="text-sm text-muted-foreground mt-0.5">{getRecordLabel(record)}</p>
        </div>
        <div className="flex items-start gap-2">
        <Button
          size="sm"
          variant="outline"
          className="gap-1 text-xs text-purple-700 border-purple-300 hover:bg-purple-50 shrink-0"
          disabled={aiAnalyzingId === record.id}
          onClick={async () => {
            setAiAnalyzingId(record.id);
            try {
              const result = await analyzeRecordAI({ recordId: record.id, projectId });
              onRecordUpdated({
                ...record,
                aiConfidence: result.aiConfidence,
                aiReasoning: result.aiReasoning,
                aiIssueType: result.aiIssueType,
                aiIssueSummary: result.aiIssueSummary,
                aiAnalysisFindings: result.aiFindings as any,
                recommendedDisposition: result.recommendedDisposition,
                recommendedDispositionReason: result.recommendedDispositionReason,
                suggestedQuestion: result.suggestedQuestion,
              });
              onRefetch();
              toast.success('AI analysis complete');
            } catch (err) {
              captureError(err as Error);
              toast.error('AI analysis failed');
            } finally {
              setAiAnalyzingId(null);
            }
          }}
        >
          {aiAnalyzingId === record.id
            ? <><Loader2 className="h-3.5 w-3.5 animate-spin" /> Analyzing…</>
            : <><Brain className="h-3.5 w-3.5" /> Check for contextual issues</>}
        </Button>
        {aiAnalyzingId !== record.id && (
          <p className="text-[10px] text-muted-foreground mt-1.5 leading-snug max-w-[240px]">
            Optional AI review for ambiguity or business context beyond destination rules.
          </p>
        )}
        </div>
      </div>

      {/* === DECISION SUMMARY CARD === */}
      <Card className={`border-2 ${
        ruleFindings.length > 0 ? 'border-destructive/50 bg-red-50/40' :
        disp && dispConfig ? dispConfig.cardClass :
        'border-border bg-muted/20'
      }`}>
        <CardContent className="p-4">
          <div className="flex items-start gap-3">
            <div className="flex-1 space-y-2">
              {/* Recommended action */}
              <div className="flex items-center gap-2 flex-wrap">
                {ruleFindings.length > 0 ? (
                  <div className="flex items-center gap-1.5">
                    <ShieldAlert className="h-4 w-4 text-destructive" />
                    <span className="text-sm font-bold text-destructive">Rule Violations — cannot approve</span>
                  </div>
                ) : disp && dispConfig ? (
                  <div className="flex items-center gap-1.5">
                    {dispConfig.icon}
                    <span className="text-sm font-bold">
                      {disp === 'ready_for_approval' ? 'Ready to Approve' : dispConfig.label}
                    </span>
                  </div>
                ) : (
                  <span className="text-sm font-medium text-muted-foreground">No recommendation yet</span>
                )}
                {record.aiConfidence !== null && record.aiConfidence !== undefined && disp && (
                  <span className="text-[10px] bg-muted text-muted-foreground rounded px-1.5 py-0.5">
                    {Math.round(record.aiConfidence * 100)}% confidence
                  </span>
                )}
              </div>

              {/* Blocking issues summary */}
              {blockingCount > 0 && (
                <div className="flex gap-2 flex-wrap text-[11px]">
                  {ruleFindings.length > 0 && (
                    <span className="inline-flex items-center gap-1 bg-red-100 text-red-700 rounded px-2 py-0.5">
                      <ShieldAlert className="h-3 w-3" />
                      {ruleFindings.length} rule violation{ruleFindings.length !== 1 ? 's' : ''}
                    </span>
                  )}
                  {dupMatches && dupMatches.length > 0 && (
                    <span className="inline-flex items-center gap-1 bg-orange-100 text-orange-700 rounded px-2 py-0.5">
                      <Layers className="h-3 w-3" />
                      {dupMatches.length} likely duplicate{dupMatches.length !== 1 ? 's' : ''}
                    </span>
                  )}
                </div>
              )}

              {/* Brief reasoning */}
              {record.recommendedDispositionReason && (
                <p className="text-xs text-muted-foreground leading-relaxed line-clamp-2">
                  {record.recommendedDispositionReason}
                </p>
              )}
            </div>

            {/* Primary action buttons */}
            <div className="flex flex-col gap-1.5 shrink-0">
              {isFinalStatus(record.status) ? (
                <Button
                  size="sm"
                  variant="outline"
                  className="gap-1 text-xs text-amber-700 border-amber-300 hover:bg-amber-50"
                  onClick={onChangeDisposition}
                >
                  <RotateCcw className="h-3.5 w-3.5" /> Change Decision
                </Button>
              ) : (
                <>
                  {ruleFindings.length === 0 && (
                    <Button
                      size="sm"
                      className="gap-1 text-xs bg-green-600 hover:bg-green-700"
                      onClick={() => onStatus('approved')}
                      disabled={updateIsPending || record.status === 'approved'}
                    >
                      <Check className="h-3.5 w-3.5" /> Approve
                    </Button>
                  )}
                  <Button
                    size="sm"
                    variant="outline"
                    className="gap-1 text-xs"
                    onClick={onDiscuss}
                  >
                    <MessageSquare className="h-3.5 w-3.5" /> Discuss
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    className="text-destructive hover:bg-destructive/10 gap-1 text-xs"
                    onClick={() => onStatus('excluded')}
                    disabled={updateIsPending || record.status === 'excluded'}
                  >
                    <X className="h-3.5 w-3.5" /> Exclude
                  </Button>
                  {dupMatches && dupMatches.length > 0 && (
                    <Button
                      size="sm"
                      variant="outline"
                      className="gap-1 text-xs"
                      onClick={onConsolidate}
                    >
                      <Layers className="h-3.5 w-3.5" /> Consolidate
                    </Button>
                  )}
                </>
              )}
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Finalized notice */}
      {isFinalStatus(record.status) && (
        <div className="bg-muted/60 border border-border rounded p-3 flex items-start gap-2">
          <History className="h-4 w-4 text-muted-foreground mt-0.5 shrink-0" />
          <div>
            <p className="text-xs font-medium">Final disposition: <span className="font-bold">{STATUS_CONFIG[record.status]?.label}</span></p>
            <p className="text-[11px] text-muted-foreground mt-0.5">Original decision preserved in the audit log. Use "Change Decision" to reverse.</p>
          </div>
        </div>
      )}

      {/* Destination Rule Violations — always highly visible */}
      {ruleFindings.length > 0 && (
        <Card className="border-destructive/40 bg-red-50/60">
          <CardContent className="p-4">
            <div className="flex items-center gap-2 mb-3">
              <div className="h-7 w-7 rounded-md bg-destructive/10 flex items-center justify-center shrink-0">
                <ShieldAlert className="h-4 w-4 text-destructive" />
              </div>
              <div className="flex-1">
                <p className="text-sm font-bold text-destructive">Destination Rule Violations</p>
                <p className="text-[10px] text-red-600">Deterministic — based on confirmed, human-approved requirements</p>
              </div>
              <Badge variant="outline" className="text-[9px] px-1.5 bg-red-100 text-red-700 border-red-300 shrink-0">
                {ruleFindings.length} violation{ruleFindings.length !== 1 ? 's' : ''}
              </Badge>
            </div>
            <div className="space-y-3">
              {ruleFindings.map((f, i) => {
                const ruleLabel = f.rule === 'required' ? 'Required field missing'
                  : f.rule === 'unique' ? 'Duplicate value'
                  : f.rule === 'email_format' ? 'Invalid email format'
                  : f.rule === 'allowed_values' ? 'Value not in allowed list'
                  : f.rule === 'data_type' ? 'Wrong data type'
                  : f.rule ? f.rule.replace(/_/g, ' ') : 'Rule violation';

                const nextStep = f.rule === 'required'
                  ? 'Request the missing value from the source stakeholder, or exclude this record.'
                  : f.rule === 'unique'
                  ? 'Check for duplicates and consolidate or exclude one of the conflicting records.'
                  : f.rule === 'allowed_values'
                  ? 'Ask the source team to correct the value, or update the allowed-values list if the destination accepts it.'
                  : f.rule === 'email_format'
                  ? 'Ask the source team to provide a valid email address for this record.'
                  : 'Discuss with the source stakeholder to clarify the correct value.';

                return (
                  <div key={i} className="bg-white/80 rounded-lg border border-red-200 overflow-hidden">
                    {/* Compact summary block */}
                    <div className="grid grid-cols-2 gap-0 divide-x divide-red-100 border-b border-red-200">
                      <div className="px-3 py-2">
                        <p className="text-[9px] font-bold text-red-500 uppercase tracking-wider mb-0.5">Blocking rule</p>
                        <p className="text-xs font-semibold text-destructive">{ruleLabel}</p>
                        <p className="text-[10px] text-muted-foreground mt-0.5">{f.field}</p>
                      </div>
                      <div className="px-3 py-2">
                        <p className="text-[9px] font-bold text-red-500 uppercase tracking-wider mb-0.5">Original source value</p>
                        <p className="text-xs font-mono text-foreground">
                          {f.sourceValue === null || f.sourceValue === undefined
                            ? <span className="italic text-muted-foreground">Missing</span>
                            : f.sourceValue || <span className="italic text-muted-foreground">(empty)</span>
                          }
                        </p>
                      </div>
                    </div>
                    <div className="grid grid-cols-2 gap-0 divide-x divide-red-100 border-b border-red-200">
                      <div className="px-3 py-2">
                        <p className="text-[9px] font-bold text-red-500 uppercase tracking-wider mb-0.5">Destination requirement</p>
                        <p className="text-xs text-foreground">
                          {f.expectedValue
                            ? <span className="font-mono">{f.expectedValue}</span>
                            : f.explanation
                          }
                        </p>
                      </div>
                      <div className="px-3 py-2 bg-amber-50/60">
                        <p className="text-[9px] font-bold text-amber-600 uppercase tracking-wider mb-0.5">Recommended next step</p>
                        <p className="text-[10px] text-foreground leading-snug">{nextStep}</p>
                      </div>
                    </div>
                    {/* Technical detail */}
                    {f.explanation && f.explanation !== nextStep && (
                      <div className="px-3 py-1.5 border-b border-red-100 bg-red-50/30">
                        <p className="text-[10px] text-muted-foreground leading-snug">{f.explanation}</p>
                      </div>
                    )}
                    {/* Remediation Panel */}
                    {!isFinalStatus(record.status) && (
                      <RemediationPanel
                        finding={f}
                        record={record}
                        projectId={projectId}
                        migrationValues={migrationValues}
                        onSaved={(updated) => {
                          onRecordUpdated(updated);
                          migrationValuesQuery.refetch?.();
                          recordDetailQuery.refetch?.();
                          onRefetch();
                        }}
                      />
                    )}
                  </div>
                );
              })}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Duplicate Evidence */}
      {dupMatches && dupMatches.length > 0 && (
        <Card className="border-orange-300 bg-orange-50/40">
          <CardContent className="p-4">
            <div className="flex items-center gap-2 mb-3">
              <div className="h-7 w-7 rounded-md bg-orange-100 flex items-center justify-center shrink-0">
                <Layers className="h-4 w-4 text-orange-600" />
              </div>
              <div className="flex-1">
                <p className="text-sm font-bold text-orange-800">Likely Duplicate{dupMatches.length > 1 ? 's' : ''} Detected</p>
                <p className="text-[10px] text-orange-600">
                  Identity-based comparison found {dupMatches.length} matching record{dupMatches.length > 1 ? 's' : ''}
                </p>
              </div>
              {!isFinalStatus(record.status) && (
                <Button
                  size="sm"
                  variant="outline"
                  className="text-xs gap-1 border-orange-300 text-orange-700 hover:bg-orange-50 shrink-0"
                  onClick={onConsolidate}
                >
                  <Layers className="h-3.5 w-3.5" /> Consolidate
                </Button>
              )}
            </div>
            <div className="space-y-2">
              {dupMatches.map((match, i) => (
                <div key={i} className="bg-white/80 rounded border border-orange-200 p-3">
                  <div className="flex items-center justify-between mb-2">
                    <div className="flex items-center gap-2">
                      <Users className="h-3.5 w-3.5 text-orange-500" />
                      <span className="text-xs font-semibold">Record #{match.rowNumber}</span>
                      <span className="text-[10px] text-muted-foreground">{match.recordSummary}</span>
                    </div>
                    <div className="flex items-center gap-1.5">
                      {match.matchCategory && (
                        <Badge variant="outline" className="text-[9px] bg-blue-50 text-blue-700 border-blue-200">
                          {match.matchCategory === 'source_to_source' ? 'source↔source' : 'source→dest'}
                        </Badge>
                      )}
                      <Badge variant="outline" className="text-[9px] bg-orange-50 text-orange-700 border-orange-300">
                        {Math.round(match.confidence * 100)}% match
                      </Badge>
                    </div>
                  </div>
                  {match.explanation && (
                    <p className="text-[10px] text-muted-foreground italic mb-2">{match.explanation}</p>
                  )}
                  <div className="flex flex-wrap gap-1">
                    {match.matchingFields.map((f, j) => (
                      <span key={j} className="inline-flex items-center gap-1 text-[10px] bg-green-50 border border-green-200 rounded px-1.5 py-0.5">
                        <span className="font-medium">{f.field}:</span>
                        <span className="font-mono">{f.value}</span>
                        <span className="text-green-600 text-[9px]">({f.matchType})</span>
                      </span>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* AI Contextual Analysis — summarized, expandable */}
      {(record.aiReasoning || aiFindings.length > 0) && (
        <Card className={`border-secondary/40 ${aiFoundNothing ? 'bg-green-50/40' : 'bg-secondary/5'}`}>
          <CardContent className="p-4">
            <div className="flex items-center gap-2 mb-3">
              <div className={`h-7 w-7 rounded-md flex items-center justify-center shrink-0 ${
                aiFoundNothing ? 'bg-green-100' : 'bg-secondary/30'
              }`}>
                <Brain className={`h-4 w-4 ${aiFoundNothing ? 'text-green-700' : 'text-secondary-foreground'}`} />
              </div>
              <div className="flex-1">
                <p className="text-sm font-bold">AI Contextual Analysis</p>
                <p className="text-[10px] text-muted-foreground">Evidence-based — only flags concrete source data issues</p>
              </div>
              {record.aiConfidence !== null && record.aiConfidence !== undefined && (
                <span className="text-xs text-muted-foreground shrink-0">
                  {Math.round(record.aiConfidence * 100)}% confidence
                </span>
              )}
            </div>

            {/* No issues found — clean bill */}
            {aiFoundNothing && (
              <div className="flex items-center gap-2 bg-green-100 border border-green-300 rounded px-3 py-2 mb-2">
                <CheckCircle2 className="h-4 w-4 text-green-600 shrink-0" />
                <p className="text-xs font-medium text-green-800">No additional contextual issues found.</p>
              </div>
            )}

            {/* Show top 1 finding */}
            {topAiFindings.length > 0 && (
              <div className="space-y-2 mb-2">
                {topAiFindings.map((f, i) => (
                  <div key={i} className="bg-white/70 rounded border border-secondary/30 px-3 py-2.5">
                    <div className="flex items-center gap-2 mb-1.5 flex-wrap">
                      {f.issueType && (
                        <span className={`text-[9px] rounded px-1.5 py-0.5 font-semibold uppercase tracking-wide ${
                          f.issueType === 'test_data' ? 'bg-gray-100 text-gray-700' :
                          f.issueType === 'obsolete' ? 'bg-gray-100 text-gray-700' :
                          f.issueType === 'needs_clarification' ? 'bg-blue-100 text-blue-700' :
                          f.issueType === 'conflict' ? 'bg-orange-100 text-orange-700' :
                          'bg-secondary/20 text-secondary-foreground'
                        }`}>
                          {f.issueType === 'test_data' ? 'Test / Non-Production' :
                           f.issueType === 'obsolete' ? 'Recommended Exclusion' :
                           f.issueType === 'needs_clarification' ? 'Needs Clarification' :
                           f.issueType === 'conflict' ? 'Conflict' :
                           f.issueType.replace(/_/g, ' ')}
                        </span>
                      )}
                      {f.confidence !== undefined && (
                        <span className="text-[9px] bg-muted text-muted-foreground rounded px-1.5 py-0.5 ml-auto">
                          {Math.round(f.confidence * 100)}% confidence
                        </span>
                      )}
                    </div>
                    <p className="text-xs text-foreground leading-snug font-medium mb-1.5">{f.explanation}</p>
                    {f.evidence && (
                      <div className="text-[10px] bg-muted/40 rounded px-2 py-1 mb-1 font-mono">
                        <span className="font-sans text-muted-foreground font-semibold not-italic">Source: </span>{f.evidence}
                      </div>
                    )}
                    {f.whyItMatters && (
                      <p className="text-[10px] text-muted-foreground mt-0.5">
                        <span className="font-semibold">Migration risk:</span> {f.whyItMatters}
                      </p>
                    )}
                    {f.recommendedAction && (
                      <p className="text-[10px] text-blue-700 mt-0.5">
                        <span className="font-semibold">Action:</span> {f.recommendedAction}
                      </p>
                    )}
                  </div>
                ))}
              </div>
            )}

            {/* Expand for reasoning + more findings */}
            {(record.aiReasoning || hiddenAiFindings.length > 0) && (
              <button
                className="flex items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground transition-colors cursor-pointer"
                onClick={() => setAiExpandedDetail(!aiExpandedDetail)}
              >
                {aiExpandedDetail ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
                {aiExpandedDetail ? 'Hide analysis details' : 'View analysis details'}
                {hiddenAiFindings.length > 0 && !aiExpandedDetail && (
                  <span className="text-[10px] text-muted-foreground ml-1">
                    (+{hiddenAiFindings.length} more finding{hiddenAiFindings.length !== 1 ? 's' : ''})
                  </span>
                )}
              </button>
            )}

            {aiExpandedDetail && (
              <div className="mt-3 space-y-3 border-t border-secondary/20 pt-3">
                {record.aiReasoning && (
                  <p className="text-xs text-muted-foreground leading-relaxed">{record.aiReasoning}</p>
                )}
                {hiddenAiFindings.length > 0 && (
                  <div className="space-y-2">
                    {hiddenAiFindings.map((f, i) => (
                      <div key={i} className="bg-white/70 rounded border border-secondary/30 px-3 py-2.5">
                        <div className="flex items-center gap-2 mb-1.5 flex-wrap">
                          {f.issueType && (
                            <span className={`text-[9px] rounded px-1.5 py-0.5 font-semibold uppercase tracking-wide ${
                              f.issueType === 'test_data' ? 'bg-gray-100 text-gray-700' :
                              f.issueType === 'obsolete' ? 'bg-gray-100 text-gray-700' :
                              f.issueType === 'needs_clarification' ? 'bg-blue-100 text-blue-700' :
                              f.issueType === 'conflict' ? 'bg-orange-100 text-orange-700' :
                              'bg-secondary/20 text-secondary-foreground'
                            }`}>
                              {f.issueType === 'test_data' ? 'Test / Non-Production' :
                               f.issueType === 'obsolete' ? 'Recommended Exclusion' :
                               f.issueType === 'needs_clarification' ? 'Needs Clarification' :
                               f.issueType === 'conflict' ? 'Conflict' :
                               f.issueType.replace(/_/g, ' ')}
                            </span>
                          )}
                          {f.confidence !== undefined && (
                            <span className="text-[9px] bg-muted text-muted-foreground rounded px-1.5 py-0.5 ml-auto">
                              {Math.round(f.confidence * 100)}% confidence
                            </span>
                          )}
                        </div>
                        <p className="text-xs text-foreground leading-snug font-medium mb-1.5">{f.explanation}</p>
                        {f.evidence && (
                          <div className="text-[10px] bg-muted/40 rounded px-2 py-1 mb-1 font-mono">
                            <span className="font-sans text-muted-foreground font-semibold not-italic">Source: </span>{f.evidence}
                          </div>
                        )}
                        {f.whyItMatters && (
                          <p className="text-[10px] text-muted-foreground mt-0.5">
                            <span className="font-semibold">Migration risk:</span> {f.whyItMatters}
                          </p>
                        )}
                        {f.recommendedAction && (
                          <p className="text-[10px] text-blue-700 mt-0.5">
                            <span className="font-semibold">Action:</span> {f.recommendedAction}
                          </p>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}

            {/* If no findings and no reasoning yet */}
            {aiFindings.length === 0 && !record.aiReasoning && (
              <p className="text-xs text-muted-foreground italic mt-1">No AI findings recorded. Use "Analyze with AI" for contextual analysis.</p>
            )}
          </CardContent>
        </Card>
      )}

      {/* Open Discussions */}
      {discussions && discussions.length > 0 && (
        <Card className="border-blue-200 bg-blue-50/40">
          <CardContent className="p-4">
            <div className="flex items-center gap-2 mb-3">
              <div className="h-7 w-7 rounded-md bg-blue-100 flex items-center justify-center shrink-0">
                <MessageSquare className="h-4 w-4 text-blue-600" />
              </div>
              <p className="text-sm font-bold text-blue-800">Discussion History</p>
              <span className="text-[10px] bg-blue-100 text-blue-700 rounded-full px-2 py-0.5">{discussions.length}</span>
            </div>
            <div className="space-y-4">
              {discussions.map((d: any) => (
                <DiscussionThread
                  key={d.id}
                  discussion={d}
                  record={record}
                  projectId={projectId}
                  isFinalStatus={isFinalStatus}
                  onResolve={() => onResolveDiscussion(d.id)}
                  onRefetch={() => { recordDetailQuery.refetch?.(); onRefetch(); }}
                  appUsers={appUsers}
                  ruleFindings={ruleFindings}
                  migrationValues={migrationValues}
                  onMigrationValueSaved={(updated) => {
                    onRecordUpdated(updated);
                    migrationValuesQuery.refetch?.();
                    recordDetailQuery.refetch?.();
                    onRefetch();
                  }}
                />
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Source Data */}
      <Card>
        <CardContent className="p-4">
          <h4 className="text-xs font-bold text-muted-foreground uppercase tracking-widest mb-3">
            Source Data
          </h4>
          <div className="grid grid-cols-2 gap-3">
            {Object.entries(dataObj(record)).map(([key, value]) => (
              <div key={key} className="space-y-1">
                <label className="text-[10px] font-medium text-muted-foreground uppercase tracking-wide">{key}</label>
                <div className="text-sm p-2 bg-muted/30 rounded border border-border/50 font-mono">
                  {value === null || value === undefined || value === ''
                    ? <span className="text-muted-foreground italic">empty</span>
                    : String(value)
                  }
                </div>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      {record.reviewNote && (
        <Card>
          <CardContent className="p-4">
            <p className="text-xs font-bold text-muted-foreground uppercase tracking-widest mb-2">Review Note</p>
            <p className="text-sm">{record.reviewNote}</p>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

// ---- Finalization Dialog ----

interface FinalizationDialogProps {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  projectId: number;
  checklist: FinalizationChecklist | null;
  onFinalized: () => void;
}

function FinalizationDialog({ open, onOpenChange, projectId, checklist, onFinalized }: FinalizationDialogProps) {
  const navigate = useNavigate();

  const finalizeMutation = useServerMutation(finalizeProject, {
    onSuccess: () => {
      toast.success('Migration completed! A permanent snapshot has been recorded.');
      onFinalized();
    },
    onError: () => toast.error('Completion failed. Please resolve all blocking items.'),
  });

  const canFinalize = checklist?.canFinalize ?? false;
  const items = checklist?.items ?? [];
  const hasBlockingItems = items.some(i => i.status === 'blocking');

  // Queue links for unresolved categories
  const pendingCount = checklist?.pending ?? 0;
  const discussingCount = checklist?.discussing ?? 0;
  const approvedCount = checklist?.approved ?? 0;

  const blockingViolationsItem = items.find(i => i.key === 'no_blocking_violations');
  const openDiscussionsItem = items.find(i => i.key === 'no_open_discussions');
  const blockingViolationCount = blockingViolationsItem?.status === 'blocking'
    ? parseInt(blockingViolationsItem.detail.match(/^(\d+)/)?.[1] ?? '0', 10)
    : 0;
  const openDiscussionCount = openDiscussionsItem?.status === 'blocking'
    ? parseInt(openDiscussionsItem.detail.match(/^(\d+)/)?.[1] ?? '0', 10)
    : 0;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg max-h-[92vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Flag className="h-5 w-5 text-primary" />
            {canFinalize ? 'Complete Migration' : 'Finish Review'}
          </DialogTitle>
          <DialogDescription>
            {canFinalize
              ? 'All requirements are met. Completing the migration locks the project and creates an immutable audit snapshot.'
              : 'Review the status below. You can export approved data at any time, or resolve all blocking items to complete the migration.'}
          </DialogDescription>
        </DialogHeader>

        {checklist && (
          <div className="space-y-4 py-2">
            {/* Metrics grid */}
            <div className="grid grid-cols-2 gap-2">
              <div className="rounded-lg bg-muted/60 border border-border px-3 py-2.5">
                <p className="text-lg font-bold">{checklist.tracked} <span className="text-xs font-normal text-muted-foreground">of {checklist.total}</span></p>
                <p className="text-[10px] text-muted-foreground">Source records tracked</p>
              </div>
              <div className="rounded-lg bg-green-50 border border-green-200 px-3 py-2.5">
                <p className="text-lg font-bold text-green-700">{checklist.finalized} <span className="text-xs font-normal text-muted-foreground">of {checklist.total}</span></p>
                <p className="text-[10px] text-muted-foreground">Source records finalized</p>
              </div>
            </div>

            {/* Unresolved breakdown */}
            {checklist.unresolved > 0 && (
              <div className="rounded-lg border border-amber-200 bg-amber-50/60 px-4 py-3 space-y-2">
                <p className="text-xs font-semibold text-amber-800">{checklist.unresolved} records still unresolved</p>
                <div className="flex flex-col gap-1.5">
                  {pendingCount > 0 && (
                    <div className="flex items-center justify-between text-xs">
                      <span className="text-amber-700">
                        <CircleDot className="h-3 w-3 inline mr-1" />
                        {pendingCount} pending
                      </span>
                      <button
                        className="text-[10px] text-primary underline cursor-pointer"
                        onClick={() => { navigate(`/projects/${projectId}/review?queue=pending`); onOpenChange(false); }}
                      >
                        Review pending →
                      </button>
                    </div>
                  )}
                  {discussingCount > 0 && (
                    <div className="flex items-center justify-between text-xs">
                      <span className="text-blue-700">
                        <MessageSquare className="h-3 w-3 inline mr-1" />
                        {discussingCount} in discussion
                      </span>
                      <button
                        className="text-[10px] text-primary underline cursor-pointer"
                        onClick={() => { navigate(`/projects/${projectId}/review?queue=discussing`); onOpenChange(false); }}
                      >
                        View discussions →
                      </button>
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* Blocking violations summary */}
            {blockingViolationCount > 0 && (
              <div className="flex items-center justify-between rounded-lg border border-red-200 bg-red-50/60 px-4 py-2.5 text-xs">
                <span className="text-red-700">
                  <ShieldAlert className="h-3 w-3 inline mr-1" />
                  {blockingViolationCount} record{blockingViolationCount !== 1 ? 's' : ''} with blocking rule violations
                </span>
                <button
                  className="text-[10px] text-primary underline cursor-pointer"
                  onClick={() => { navigate(`/projects/${projectId}/review?queue=rule_violations`); onOpenChange(false); }}
                >
                  View violations →
                </button>
              </div>
            )}

            {/* Open discussions summary */}
            {openDiscussionCount > 0 && (
              <div className="flex items-center justify-between rounded-lg border border-blue-200 bg-blue-50/60 px-4 py-2.5 text-xs">
                <span className="text-blue-700">
                  <MessageSquare className="h-3 w-3 inline mr-1" />
                  {openDiscussionCount} open discussion{openDiscussionCount !== 1 ? 's' : ''} must be resolved
                </span>
                <button
                  className="text-[10px] text-primary underline cursor-pointer"
                  onClick={() => { navigate(`/projects/${projectId}/review?queue=discussing`); onOpenChange(false); }}
                >
                  View discussions →
                </button>
              </div>
            )}

            {/* Export approved data — always available */}
            {approvedCount > 0 && (
              <div className="rounded-lg border border-green-200 bg-green-50/40 px-4 py-3 flex items-start gap-3">
                <Download className="h-4 w-4 text-green-700 mt-0.5 shrink-0" />
                <div className="flex-1 min-w-0">
                  <p className="text-xs font-semibold text-green-800">Export Approved Data — available now</p>
                  <p className="text-[11px] text-green-700 mt-0.5">
                    {approvedCount} approved record{approvedCount !== 1 ? 's' : ''} ready for export. You can download these at any time without waiting for all records to be resolved.
                  </p>
                </div>
                <Button
                  size="sm"
                  variant="outline"
                  className="shrink-0 text-[10px] h-7 border-green-300 text-green-800 hover:bg-green-100"
                  onClick={() => { navigate(`/projects/${projectId}?export=approved`); onOpenChange(false); }}
                >
                  <Download className="h-3 w-3" /> Export
                </Button>
              </div>
            )}

            {/* Checklist */}
            <div className="space-y-1.5">
              <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Completion Checklist</p>
              {items.map(item => (
                <div key={item.key} className={`flex items-start gap-3 rounded-lg border px-3 py-2.5 ${
                  item.status === 'ok'
                    ? 'bg-green-50/60 border-green-200'
                    : item.status === 'blocking'
                      ? 'bg-red-50/60 border-red-200'
                      : 'bg-yellow-50/60 border-yellow-200'
                }`}>
                  <div className="mt-0.5 shrink-0">
                    {item.status === 'ok' && <CheckCircle2 className="h-4 w-4 text-green-600" />}
                    {item.status === 'blocking' && <AlertCircle className="h-4 w-4 text-red-600" />}
                    {item.status === 'warning' && <AlertTriangle className="h-4 w-4 text-yellow-600" />}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className={`text-xs font-semibold ${
                      item.status === 'ok' ? 'text-green-800' :
                      item.status === 'blocking' ? 'text-red-800' : 'text-yellow-800'
                    }`}>{item.label}</p>
                    <p className="text-[11px] text-muted-foreground mt-0.5">{item.detail}</p>
                    {item.link && item.status !== 'ok' && (
                      <button
                        className="text-[10px] text-primary underline mt-0.5 cursor-pointer"
                        onClick={() => { navigate(`/projects/${projectId}/${item.link}`); onOpenChange(false); }}
                      >
                        Go to {item.link} →
                      </button>
                    )}
                  </div>
                </div>
              ))}
            </div>

            {canFinalize && (
              <div className="bg-green-50 border border-green-300 rounded p-3 flex items-center gap-2">
                <PartyPopper className="h-4 w-4 text-green-700 shrink-0" />
                <p className="text-[11px] text-green-800 font-medium">
                  All checks passed! Completing migration locks this project and creates an immutable audit snapshot.
                </p>
              </div>
            )}
          </div>
        )}

        <DialogFooter className="flex-wrap gap-2">
          <Button variant="outline" onClick={() => onOpenChange(false)}>Close</Button>
          {hasBlockingItems && approvedCount > 0 && (
            <Button
              variant="outline"
              className="gap-1 border-green-300 text-green-800 hover:bg-green-50"
              onClick={() => { navigate(`/projects/${projectId}?export=approved`); onOpenChange(false); }}
            >
              <Download className="h-4 w-4" /> Export Approved Records
            </Button>
          )}
          <Button
            disabled={!canFinalize || finalizeMutation.isPending}
            onClick={() => finalizeMutation.mutate({ projectId })}
          >
            {finalizeMutation.isPending
              ? <><Loader2 className="h-4 w-4 animate-spin" /> Completing…</>
              : <><Lock className="h-4 w-4" /> Complete Migration</>
            }
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}



// ---- Reopen Dialog ----

interface ReopenDialogProps {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  projectId: number;
  onReopened: () => void;
}

function ReopenDialog({ open, onOpenChange, projectId, onReopened }: ReopenDialogProps) {
  const [reason, setReason] = useState('');

  const reopenMutation = useServerMutation(reopenProject, {
    onSuccess: () => {
      toast.success('Migration reopened. Previous finalization event preserved in audit log.');
      onReopened();
      setReason('');
    },
    onError: () => toast.error('Failed to reopen migration'),
  });

  return (
    <Dialog open={open} onOpenChange={v => { if (!v) setReason(''); onOpenChange(v); }}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Unlock className="h-5 w-5 text-amber-600" />
            Reopen Finalized Migration
          </DialogTitle>
          <DialogDescription>
            A reason is required. The previous finalization event will be permanently preserved in the audit history.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3 py-2">
          <div className="bg-amber-50 border border-amber-200 rounded p-3">
            <p className="text-[11px] text-amber-700">
              Reopening does <strong>not</strong> delete the finalization event. It appends a new audit entry recording who reopened the migration and why.
            </p>
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs font-semibold">Reason for Reopening <span className="text-destructive">*</span></Label>
            <Textarea
              placeholder="Why is this finalized migration being reopened? What needs to change?"
              value={reason}
              onChange={e => setReason(e.target.value)}
              rows={3}
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button
            variant="destructive"
            disabled={!reason.trim() || reopenMutation.isPending}
            onClick={() => reopenMutation.mutate({ projectId, reason })}
          >
            {reopenMutation.isPending
              ? <><Loader2 className="h-4 w-4 animate-spin" /> Reopening…</>
              : <><Unlock className="h-4 w-4" /> Reopen Migration</>
            }
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}