import { usePageTitle, useParams, useServerMutation, captureError } from '@aha-app/builder-core';
import {
  useGetProject,
  useGetDestinationFields,
  useGetSourceFiles,
  useGetDuplicateRequirements,
  createDestinationField,
  updateDestinationField,
  deleteDestinationField,
  confirmRequirement,
  bulkConfirmRequirements,
  suggestRequirementsFromTemplate,
} from '@/server';
import AppHeader from '@/components/AppHeader';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import {
  Plus,
  Trash2,
  Edit,
  CheckCircle2,
  AlertCircle,
  Upload,
  Sparkles,
  CheckCheck,
  Info,
  HelpCircle,
  ShieldCheck,
  Eye,
} from 'lucide-react';
import { useState, useRef } from 'react';
import { toast } from 'sonner';
import { read as xlsxRead, utils as xlsxUtils } from 'xlsx';
import type { DestinationField } from '@/db/schema';

const FIELD_TYPES: DestinationField['fieldType'][] = [
  'text', 'number', 'email', 'date', 'boolean', 'enum_type', 'currency', 'identifier',
];

const FIELD_TYPE_LABELS: Record<string, string> = {
  text: 'Text',
  number: 'Number',
  email: 'Email Address',
  date: 'Date',
  boolean: 'Yes / No',
  enum_type: 'List of Values',
  currency: 'Currency',
  identifier: 'Identifier / ID',
};

type FieldForm = {
  fieldName: string;
  fieldType: DestinationField['fieldType'];
  required: boolean;
  isUnique: boolean;
  allowedValues: string;
  description: string;
};

const defaultForm: FieldForm = {
  fieldName: '',
  fieldType: 'text',
  required: false,
  isUnique: false,
  allowedValues: '',
  description: '',
};

/** Shows observed sample values and AI reasoning in a popover for AI-suggested fields. */
function SuggestionReasoningPopover({ field }: { field: DestinationField }) {
  if (field.requirementSource !== 'ai_suggested') return null;
  if (!field.suggestionReasoning && !field.observedSampleValues?.length) return null;

  // Split reasoning back into general / required parts
  const parts = (field.suggestionReasoning ?? '').split(' | Required: ');
  const generalReasoning = parts[0]?.trim();
  const requiredReasoning = parts[1]?.trim();

  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          className="inline-flex items-center gap-1 text-[9px] text-secondary-foreground hover:text-foreground cursor-pointer border border-secondary/40 bg-secondary/10 hover:bg-secondary/20 rounded px-1.5 py-0.5 transition-colors"
          title="View AI reasoning"
        >
          <Eye className="h-2.5 w-2.5" />
          Why?
        </button>
      </PopoverTrigger>
      <PopoverContent
        side="left"
        align="start"
        className="w-80 text-xs"
        sideOffset={8}
      >
        <div className="space-y-3">
          <div className="flex items-center gap-1.5 font-semibold text-sm">
            <Sparkles className="h-3.5 w-3.5 text-secondary-foreground" />
            AI Suggestion Reasoning
          </div>

          {generalReasoning && (
            <div>
              <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider mb-1">Type & Constraint Inference</p>
              <p className="leading-relaxed text-foreground">{generalReasoning}</p>
            </div>
          )}

          {requiredReasoning && (
            <div>
              <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider mb-1">Required Field Evidence</p>
              <p className="leading-relaxed text-foreground">{requiredReasoning}</p>
            </div>
          )}

          {field.observedSampleValues && field.observedSampleValues.length > 0 && (
            <div>
              <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider mb-1.5">
                Observed in Sample ({field.observedSampleValues.length} distinct value{field.observedSampleValues.length !== 1 ? 's' : ''})
              </p>
              <div className="flex flex-wrap gap-1">
                {field.observedSampleValues.map((v, i) => (
                  <span
                    key={i}
                    className="inline-block bg-muted text-muted-foreground rounded px-1.5 py-0.5 text-[10px] font-mono"
                  >
                    {v}
                  </span>
                ))}
              </div>
              {field.allowedValues?.length ? (
                <p className="text-[10px] text-muted-foreground mt-1.5">
                  ✓ These values are also set as the enforced allowed-values list for this field.
                </p>
              ) : (
                <p className="text-[10px] text-muted-foreground mt-1.5">
                  These are observed only — not enforced as allowed values. The field accepts any value.
                </p>
              )}
            </div>
          )}

          <div className="pt-1 border-t border-border text-[10px] text-muted-foreground">
            Review this suggestion and confirm or edit it before it is used in analysis.
          </div>
        </div>
      </PopoverContent>
    </Popover>
  );
}

export default function RequirementsPage() {
  const { id } = useParams();
  const projectId = Number(id);
  usePageTitle('Destination Requirements | MergeFlow');

  const projectQuery = useGetProject({ id: projectId });
  const fieldsQuery = useGetDestinationFields({ projectId });
  const filesQuery = useGetSourceFiles({ projectId });
  const duplicatesQuery = useGetDuplicateRequirements({ projectId });

  const project = projectQuery.data;
  const fields = fieldsQuery.data ?? [];
  const sourceFiles = filesQuery.data ?? [];
  const sourceColumns = [...new Set(sourceFiles.flatMap(f => f.columns ?? []))];
  const destFieldNames = new Set(fields.map(f => f.fieldName.toLowerCase().trim()));
  const sourceOnlyColumns = sourceColumns.filter(col => !destFieldNames.has(col.toLowerCase().trim()));
  const sourceColumnPolicies = (project as unknown as { sourceColumnPolicies?: Record<string, string> })?.sourceColumnPolicies ?? {};

  const POLICY_LABELS: Record<string, string> = {
    keep: 'Preserved as context',
    ignore: 'Ignored',
    review: 'Flagged for review when populated',
  };
  const duplicates = duplicatesQuery.data?.duplicates ?? [];

  const [showForm, setShowForm] = useState(false);
  const [editingField, setEditingField] = useState<DestinationField | null>(null);
  const [form, setForm] = useState<FieldForm>(defaultForm);
  const [deleteId, setDeleteId] = useState<number | null>(null);
  const [isSuggestingFromFile, setIsSuggestingFromFile] = useState(false);
  const templateInputRef = useRef<HTMLInputElement>(null);

  const confirmed = fields.filter(f => f.isConfirmed);
  const aiSuggested = fields.filter(f => f.requirementSource === 'ai_suggested');
  const unconfirmed = fields.filter(f => !f.isConfirmed);
  const pendingAi = fields.filter(f => f.requirementSource === 'ai_suggested' && !f.isConfirmed);

  const createMutation = useServerMutation(createDestinationField, {
    query: fieldsQuery,
    onSuccess: () => { setShowForm(false); setForm(defaultForm); toast.success('Requirement added'); },
    onError: () => toast.error('Failed to add requirement'),
  });

  const updateMutation = useServerMutation(updateDestinationField, {
    query: fieldsQuery,
    optimistic: (prev, input) => prev?.map(f =>
      f.id === input.id ? { ...f, ...input } : f
    ),
    onSuccess: () => { setShowForm(false); setEditingField(null); },
    onError: () => toast.error('Failed to update requirement'),
    refetchOnSuccess: true,
  });

  const deleteMutation = useServerMutation(deleteDestinationField, {
    query: fieldsQuery,
    optimistic: (prev, input) => prev?.filter(f => f.id !== input.id),
    onSuccess: () => toast.success('Requirement removed'),
    onError: () => toast.error('Failed to remove requirement'),
  });

  const confirmMutation = useServerMutation(confirmRequirement, {
    query: fieldsQuery,
    optimistic: (prev, input) => prev?.map(f => f.id === input.id ? { ...f, isConfirmed: true } : f),
    onSuccess: () => toast.success('Requirement confirmed'),
    onError: () => toast.error('Failed to confirm requirement'),
  });

  const bulkConfirmMutation = useServerMutation(bulkConfirmRequirements, {
    query: fieldsQuery,
    onSuccess: (result) => toast.success(`Confirmed ${result.confirmed} requirement(s)`),
    onError: () => toast.error('Failed to confirm requirements'),
    refetchOnSuccess: true,
  });

  const suggestMutation = useServerMutation(suggestRequirementsFromTemplate, {
    query: fieldsQuery,
    onSuccess: (result) => {
      toast.success(
        result.suggested > 0
          ? `AI suggested ${result.suggested} requirement(s) — review the reasoning below before confirming`
          : 'No new requirements to suggest (all headers already exist)',
      );
    },
    onError: () => toast.error('Failed to analyze template file'),
    refetchOnSuccess: true,
  });

  const openAdd = () => { setEditingField(null); setForm(defaultForm); setShowForm(true); };
  const openEdit = (f: DestinationField) => {
    setEditingField(f);
    setForm({
      fieldName: f.fieldName,
      fieldType: f.fieldType,
      required: f.required,
      isUnique: f.isUnique,
      allowedValues: f.allowedValues?.join(', ') ?? '',
      description: f.description ?? '',
    });
    setShowForm(true);
  };

  const handleSave = () => {
    if (!form.fieldName.trim()) { toast.error('Field name is required'); return; }
    const payload = {
      fieldName: form.fieldName.trim(),
      fieldType: form.fieldType,
      required: form.required,
      isUnique: form.isUnique,
      allowedValues: form.allowedValues.trim()
        ? form.allowedValues.split(',').map(v => v.trim()).filter(Boolean)
        : undefined,
      description: form.description.trim() || undefined,
    };
    if (editingField) {
      updateMutation.mutate({ id: editingField.id, projectId, ...payload });
    } else {
      createMutation.mutate({ projectId, ...payload, requirementSource: 'manual', isConfirmed: true });
    }
  };

  const handleTemplateFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    e.target.value = '';
    setIsSuggestingFromFile(true);
    try {
      const arrayBuffer = await file.arrayBuffer();
      const workbook = xlsxRead(arrayBuffer, { type: 'array' });
      const sheetName = workbook.SheetNames[0];
      const sheet = workbook.Sheets[sheetName];
      const jsonData = xlsxUtils.sheet_to_json<Record<string, string>>(sheet, { defval: '' });
      const headers = jsonData.length > 0 ? Object.keys(jsonData[0]) : [];
      if (headers.length === 0) { toast.error('No columns found in file'); setIsSuggestingFromFile(false); return; }
      // Send up to 20 rows for richer inference
      const sampleRows = jsonData.slice(0, 20).map(row =>
        Object.fromEntries(Object.entries(row).map(([k, v]) => [k, String(v ?? '')]))
      );
      suggestMutation.mutate({ projectId, headers, sampleRows });
    } catch (err) {
      captureError(err);
      toast.error('Failed to read template file');
    } finally {
      setIsSuggestingFromFile(false);
    }
  };

  const duplicateFieldIds = new Set(
    duplicates.flatMap(d => d.fields.map(f => f.id))
  );

  return (
    <div className="min-h-screen bg-background">
      <AppHeader projectId={projectId} projectName={project?.name} />
      <main className="max-w-6xl mx-auto px-6 py-8 pb-16">
        {/* Header */}
        <div className="flex items-start justify-between mb-6">
          <div>
            <h1 className="text-3xl font-bold tracking-tight flex items-center gap-3">
              <ShieldCheck className="h-8 w-8 text-primary" />
              Destination Requirements
            </h1>
            <p className="text-muted-foreground mt-1">
              Define what the destination organization expects — these requirements drive migration readiness.
            </p>
          </div>
          <Button onClick={openAdd}>
            <Plus className="h-4 w-4" />
            Add Requirement
          </Button>
        </div>

        {/* Status summary */}
        <div className="grid grid-cols-3 gap-4 mb-6">
          <Card>
            <CardContent className="p-4">
              <div className="flex items-center gap-3">
                <div className="h-10 w-10 rounded-full bg-green-100 flex items-center justify-center">
                  <CheckCircle2 className="h-5 w-5 text-green-700" />
                </div>
                <div>
                  <div className="text-2xl font-bold text-green-700">{confirmed.length}</div>
                  <div className="text-xs text-muted-foreground">Team Verified</div>
                </div>
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-4">
              <div className="flex items-center gap-3">
                <div className="h-10 w-10 rounded-full bg-secondary/30 flex items-center justify-center">
                  <Sparkles className="h-5 w-5 text-secondary-foreground" />
                </div>
                <div>
                  <div className="text-2xl font-bold">{aiSuggested.length}</div>
                  <div className="text-xs text-muted-foreground">AI Suggested</div>
                </div>
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-4">
              <div className="flex items-center gap-3">
                <div className={`h-10 w-10 rounded-full flex items-center justify-center ${unconfirmed.length > 0 ? 'bg-yellow-100' : 'bg-muted'}`}>
                  <AlertCircle className={`h-5 w-5 ${unconfirmed.length > 0 ? 'text-yellow-700' : 'text-muted-foreground'}`} />
                </div>
                <div>
                  <div className={`text-2xl font-bold ${unconfirmed.length > 0 ? 'text-yellow-700' : ''}`}>{unconfirmed.length}</div>
                  <div className="text-xs text-muted-foreground">Pending Verification</div>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>

        {unconfirmed.length > 0 && (
          <div className="flex items-start gap-3 p-4 rounded-lg border border-yellow-200 bg-yellow-50 mb-6">
            <AlertCircle className="h-5 w-5 text-yellow-700 shrink-0 mt-0.5" />
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium text-yellow-900">
                {unconfirmed.length} requirement(s) pending verification
              </p>
              <p className="text-xs text-yellow-700 mt-0.5">
                Analysis cannot be finalized until all requirements are verified.
                Use the <strong>Why?</strong> button to see AI reasoning before verifying.
              </p>
            </div>
            {pendingAi.length > 0 && (
              <Button
                size="sm"
                className="shrink-0"
                onClick={() => bulkConfirmMutation.mutate({ projectId, fieldIds: pendingAi.map(f => f.id) })}
                disabled={bulkConfirmMutation.isPending}
              >
                <CheckCheck className="h-4 w-4" />
                Verify All Suggestions
              </Button>
            )}
          </div>
        )}

        {/* Duplicate warning */}
        {duplicates.length > 0 && (
          <div className="flex items-start gap-3 p-4 rounded-lg border border-orange-200 bg-orange-50 mb-6">
            <AlertCircle className="h-5 w-5 text-orange-600 shrink-0 mt-0.5" />
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium text-orange-900">
                {duplicates.length} duplicate requirement name{duplicates.length !== 1 ? 's' : ''} detected
              </p>
              <p className="text-xs text-orange-700 mt-0.5">
                The following field names resolve to the same normalized name and may cause ambiguous validation. Remove the duplicate(s) to ensure correct analysis:
              </p>
              <ul className="mt-1.5 space-y-1">
                {duplicates.map(d => (
                  <li key={d.normalizedName} className="text-xs text-orange-800">
                    <span className="font-medium">{d.fields.map(f => f.fieldName).join(' / ')}</span>
                    {' '}— these resolve to the same field name. Keep one and delete the other.
                  </li>
                ))}
              </ul>
            </div>
          </div>
        )}

        {/* Template upload + how it works */}
        <div className="grid grid-cols-2 gap-4 mb-6">
          <Card className="border-2 border-dashed border-border hover:border-primary/40 transition-colors">
            <CardContent className="p-5">
              <div className="flex items-start gap-4">
                <div className="h-10 w-10 rounded-lg bg-primary/10 flex items-center justify-center shrink-0">
                  <Upload className="h-5 w-5 text-primary" />
                </div>
                <div className="flex-1 min-w-0">
                  <h3 className="font-semibold text-sm mb-1">Upload Destination Template</h3>
                  <p className="text-xs text-muted-foreground mb-3">
                    Upload a CSV or Excel file from the destination system. MergeFlow inspects the columns and infers types, constraints, and observed values — without treating sample data as definitive rules.
                  </p>
                  <input
                    type="file"
                    accept=".csv,.xlsx,.xls"
                    ref={templateInputRef}
                    onChange={handleTemplateFile}
                    className="hidden"
                  />
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => templateInputRef.current?.click()}
                    disabled={isSuggestingFromFile || suggestMutation.isPending}
                  >
                    <Sparkles className="h-4 w-4" />
                    {isSuggestingFromFile || suggestMutation.isPending ? 'Analyzing...' : 'Choose File'}
                  </Button>
                </div>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardContent className="p-5">
              <div className="flex items-start gap-4">
                <div className="h-10 w-10 rounded-lg bg-secondary/30 flex items-center justify-center shrink-0">
                  <Info className="h-5 w-5 text-secondary-foreground" />
                </div>
                <div>
                  <h3 className="font-semibold text-sm mb-1">How AI Inference Works</h3>
                  <ul className="text-xs text-muted-foreground space-y-1.5">
                    <li>• Types like email, date, and currency are inferred from field names — not just sample content.</li>
                    <li>• Allowed values are only suggested for clearly categorical fields (status, tier, type). Open-ended fields like country or industry are left unconstrained.</li>
                    <li>• "Required" is based on field name and context, not just whether sample rows happened to have values.</li>
                    <li>• Use <span className="font-medium text-foreground">Why?</span> on each row to see the reasoning before confirming.</li>
                  </ul>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Requirements table */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle>Requirements ({fields.length})</CardTitle>
            <CardDescription>
              {fields.length === 0
                ? 'No requirements defined yet. Upload a destination template or add requirements manually.'
                : `${confirmed.length} confirmed, ${unconfirmed.length} awaiting review`}
            </CardDescription>
          </CardHeader>
          <CardContent className="p-0">
            {fields.length === 0 ? (
              <div className="text-center py-12 text-sm text-muted-foreground">
                <ShieldCheck className="h-10 w-10 mx-auto mb-3 opacity-20" />
                <p className="font-medium mb-1">No destination requirements yet</p>
                <p className="text-xs mb-4">Upload a template file or add requirements manually to get started.</p>
                <Button variant="outline" onClick={openAdd}>
                  <Plus className="h-4 w-4" /> Add First Requirement
                </Button>
              </div>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Field Name</TableHead>
                    <TableHead>
                        <TooltipProvider>
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <span className="flex items-center gap-1 cursor-default">Required? <HelpCircle className="h-3 w-3 text-muted-foreground" /></span>
                            </TooltipTrigger>
                            <TooltipContent side="top" className="max-w-[220px] text-xs">
                              A required field must have a non-empty value in every source record. Records missing a required field will be flagged as a rule violation.
                            </TooltipContent>
                          </Tooltip>
                        </TooltipProvider>
                      </TableHead>
                    <TableHead>
                        <TooltipProvider>
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <span className="flex items-center gap-1 cursor-default">Data Type <HelpCircle className="h-3 w-3 text-muted-foreground" /></span>
                            </TooltipTrigger>
                            <TooltipContent side="top" className="max-w-[220px] text-xs">
                              The expected format of values in this field (e.g., email, date, number). Source values that don't match the type are flagged.
                            </TooltipContent>
                          </Tooltip>
                        </TooltipProvider>
                      </TableHead>
                    <TableHead>
                        <TooltipProvider>
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <span className="flex items-center gap-1 cursor-default">Allowed Values <HelpCircle className="h-3 w-3 text-muted-foreground" /></span>
                            </TooltipTrigger>
                            <TooltipContent side="top" className="max-w-[240px] text-xs">
                              Fixed list of acceptable values for this field (e.g., Active, Inactive, Pending). Leave blank for free-text fields.
                            </TooltipContent>
                          </Tooltip>
                        </TooltipProvider>
                      </TableHead>
                    <TableHead>
                        <TooltipProvider>
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <span className="flex items-center gap-1 cursor-default">Unique? <HelpCircle className="h-3 w-3 text-muted-foreground" /></span>
                            </TooltipTrigger>
                            <TooltipContent side="top" className="max-w-[220px] text-xs">
                              Each source record must have a distinct value for this field. Duplicate values are flagged as rule violations.
                            </TooltipContent>
                          </Tooltip>
                        </TooltipProvider>
                      </TableHead>
                    <TableHead>Source</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead className="w-28"></TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {fields.map(field => (
                    <TableRow key={field.id} className={`hover:bg-muted/30 ${!field.isConfirmed ? 'bg-yellow-50/40' : ''} ${duplicateFieldIds.has(field.id) ? 'bg-orange-50/50 border-l-2 border-l-orange-400' : ''}`}>
                      <TableCell className="font-medium text-sm">
                        <div className="flex items-center gap-2">
                          {field.fieldName}
                          {field.description && (
                            <span className="text-[10px] text-muted-foreground hidden md:block truncate max-w-[120px]" title={field.description}>
                              — {field.description}
                            </span>
                          )}
                        </div>
                      </TableCell>
                      <TableCell>
                        <button
                          onClick={() => updateMutation.mutate({ id: field.id, projectId, required: !field.required })}
                          title={field.required ? 'Click to set as optional' : 'Click to set as required'}
                          className="cursor-pointer group flex items-center gap-1.5"
                        >
                          <span className={`inline-flex items-center justify-center w-7 h-4 rounded-full transition-colors ${
                            field.required ? 'bg-red-500' : 'bg-muted-foreground/30 group-hover:bg-muted-foreground/50'
                          }`}>
                            <span className={`w-3 h-3 rounded-full bg-white shadow transition-transform ${
                              field.required ? 'translate-x-1.5' : '-translate-x-1.5'
                            }`} />
                          </span>
                          <span className={`text-[10px] font-medium ${
                            field.required ? 'text-red-700' : 'text-muted-foreground'
                          }`}>
                            {field.required ? 'Required' : 'Optional'}
                          </span>
                        </button>
                      </TableCell>
                      <TableCell className="text-xs text-muted-foreground">
                        <Select
                          value={field.fieldType}
                          onValueChange={v => updateMutation.mutate({ id: field.id, projectId, fieldType: v as DestinationField['fieldType'] })}
                        >
                          <SelectTrigger className="h-7 text-xs w-[110px] border-transparent hover:border-border">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            {FIELD_TYPES.map(t => (
                              <SelectItem key={t} value={t}>{FIELD_TYPE_LABELS[t]}</SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </TableCell>
                      <TableCell className="text-xs max-w-[160px]">
                        {field.allowedValues?.length ? (
                          <div className="flex flex-wrap gap-0.5">
                            {field.allowedValues.slice(0, 4).map((v, i) => (
                              <span key={i} className="inline-block bg-muted text-muted-foreground rounded px-1 py-0.5 text-[10px]">{v}</span>
                            ))}
                            {field.allowedValues.length > 4 && (
                              <span className="text-[10px] text-muted-foreground">+{field.allowedValues.length - 4} more</span>
                            )}
                          </div>
                        ) : field.observedSampleValues?.length && field.requirementSource === 'ai_suggested' ? (
                          <span className="text-[10px] text-muted-foreground italic">
                            Any (see Why?)
                          </span>
                        ) : (
                          <span className="text-[10px] text-muted-foreground italic">Any</span>
                        )}
                      </TableCell>
                      <TableCell>
                        {field.isUnique
                          ? <Badge variant="outline" className="text-[9px] px-1.5 bg-purple-50 text-purple-700 border-purple-200">Unique</Badge>
                          : <span className="text-[10px] text-muted-foreground">No</span>}
                      </TableCell>
                      <TableCell>
                        {field.requirementSource === 'ai_suggested' ? (
                          <div className="flex items-center gap-1.5">
                            <Badge variant="outline" className="text-[9px] px-1.5 bg-secondary/20 text-secondary-foreground border-secondary/30 gap-1">
                              <Sparkles className="h-2.5 w-2.5" />
                              AI Suggested
                            </Badge>
                            <SuggestionReasoningPopover field={field} />
                          </div>
                        ) : (
                          <Badge variant="outline" className="text-[9px] px-1.5 bg-blue-50 text-blue-700 border-blue-200">
                            Manual
                          </Badge>
                        )}
                      </TableCell>
                      <TableCell>
                        {field.isConfirmed ? (
                          <Badge variant="outline" className="text-[9px] px-1.5 bg-green-50 text-green-700 border-green-200 gap-1">
                            <CheckCircle2 className="h-2.5 w-2.5" />
                            Verified
                          </Badge>
                        ) : (
                          <Badge variant="outline" className="text-[9px] px-1.5 bg-yellow-50 text-yellow-700 border-yellow-200 gap-1">
                              <AlertCircle className="h-2.5 w-2.5" />
                              Pending
                            </Badge>
                        )}
                      </TableCell>
                      <TableCell>
                        <div className="flex items-center gap-1">
                          {!field.isConfirmed && (
                            <Button
                              variant="ghost"
                              size="sm"
                              className="h-7 px-2 text-[10px] text-green-700 hover:bg-green-50 hover:text-green-800"
                              onClick={() => confirmMutation.mutate({ id: field.id, projectId })}
                              disabled={confirmMutation.isPending}
                            >
                              <CheckCircle2 className="h-3 w-3" />
                              Verify
                            </Button>
                          )}
                          <Button
                            variant="ghost" size="icon"
                            className="h-7 w-7 text-muted-foreground hover:text-foreground"
                            onClick={() => openEdit(field)}
                          >
                            <Edit className="h-3.5 w-3.5" />
                          </Button>
                          <Button
                            variant="ghost" size="icon"
                            className="h-7 w-7 text-muted-foreground hover:text-destructive"
                            onClick={() => setDeleteId(field.id)}
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>

        {/* Source-Only Columns */}
        {sourceOnlyColumns.length > 0 && (
          <Card className="mt-6">
            <CardHeader className="pb-3">
              <div className="flex items-center gap-2">
                <Info className="h-4 w-4 text-primary shrink-0" />
                <CardTitle className="text-base">Source-Only Columns ({sourceOnlyColumns.length})</CardTitle>
              </div>
              <CardDescription className="mt-2 text-sm leading-relaxed">
                These fields exist in the incoming source but not in the destination schema. MergeFlow can preserve them as context for analysis and audit without exporting them.
              </CardDescription>
            </CardHeader>
            <CardContent className="p-0">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Column Name</TableHead>
                    <TableHead>Current Policy</TableHead>
                    <TableHead className="text-muted-foreground text-xs">Export status</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {sourceOnlyColumns.map(col => {
                    const policy = sourceColumnPolicies[col] ?? 'keep';
                    return (
                      <TableRow key={col}>
                        <TableCell className="font-mono text-sm">{col}</TableCell>
                        <TableCell>
                          <Badge
                            variant="outline"
                            className={`text-[10px] px-2 ${
                              policy === 'keep' ? 'bg-blue-50 text-blue-700 border-blue-200'
                              : policy === 'ignore' ? 'bg-muted text-muted-foreground'
                              : 'bg-yellow-50 text-yellow-700 border-yellow-200'
                            }`}
                          >
                            {POLICY_LABELS[policy] ?? policy}
                          </Badge>
                        </TableCell>
                        <TableCell className="text-xs text-muted-foreground italic">
                          Not exported — source data only
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
              <div className="px-4 py-3 text-xs text-muted-foreground border-t border-border bg-muted/20 rounded-b-lg">
                Policies for source-only columns can be changed during setup in the Field Mapping step.
              </div>
            </CardContent>
          </Card>
        )}
      </main>

      {/* Add/Edit Dialog */}
      <Dialog open={showForm} onOpenChange={setShowForm}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>{editingField ? 'Edit Requirement' : 'Add Destination Requirement'}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label>Field Name <span className="text-destructive">*</span></Label>
              <Input
                placeholder="e.g., Legal Name, Tax ID, Email Address"
                value={form.fieldName}
                onChange={e => setForm(f => ({ ...f, fieldName: e.target.value }))}
              />
            </div>
            <div className="space-y-2">
              <Label>Data Type</Label>
              <Select value={form.fieldType} onValueChange={v => setForm(f => ({ ...f, fieldType: v as DestinationField['fieldType'] }))}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {FIELD_TYPES.map(t => (
                    <SelectItem key={t} value={t}>{FIELD_TYPE_LABELS[t]}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className={`flex items-center gap-3 rounded-lg border-2 p-3 cursor-pointer transition-colors ${
                form.required ? 'border-red-300 bg-red-50' : 'border-border bg-muted/20 hover:bg-muted/40'
              }`} onClick={() => setForm(f => ({ ...f, required: !f.required }))}
              >
                <Switch checked={form.required} onCheckedChange={v => setForm(f => ({ ...f, required: v }))} />
                <div>
                  <Label className={`cursor-pointer font-semibold ${form.required ? 'text-red-700' : ''}`}>
                    Required
                  </Label>
                  <p className="text-[10px] text-muted-foreground mt-0.5">
                    Must have a value in every record
                  </p>
                </div>
              </div>
              <div className={`flex items-center gap-3 rounded-lg border-2 p-3 cursor-pointer transition-colors ${
                form.isUnique ? 'border-purple-300 bg-purple-50' : 'border-border bg-muted/20 hover:bg-muted/40'
              }`} onClick={() => setForm(f => ({ ...f, isUnique: !f.isUnique }))}
              >
                <Switch checked={form.isUnique} onCheckedChange={v => setForm(f => ({ ...f, isUnique: v }))} />
                <div>
                  <Label className={`cursor-pointer font-semibold ${form.isUnique ? 'text-purple-700' : ''}`}>
                    Must be unique
                  </Label>
                  <p className="text-[10px] text-muted-foreground mt-0.5">
                    No duplicate values allowed
                  </p>
                </div>
              </div>
            </div>
            <div className="space-y-2">
              <div className="flex items-center gap-1.5">
                <Label>Allowed Values</Label>
                <TooltipProvider>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <HelpCircle className="h-3.5 w-3.5 text-muted-foreground cursor-help" />
                    </TooltipTrigger>
                    <TooltipContent side="top" className="max-w-[240px] text-xs">
                      Enter a comma-separated list of accepted values for fields like status or tier (e.g., Active, Inactive, Pending). Leave blank for fields that accept any text.
                    </TooltipContent>
                  </Tooltip>
                </TooltipProvider>
                <span className="text-xs text-muted-foreground">(comma-separated, picklists only)</span>
              </div>
              <Input
                placeholder="e.g., Active, Inactive, Pending — leave blank for free-text fields"
                value={form.allowedValues}
                onChange={e => setForm(f => ({ ...f, allowedValues: e.target.value }))}
              />
            </div>
            <div className="space-y-2">
              <Label>Description <span className="text-xs text-muted-foreground font-normal">(optional)</span></Label>
              <Input
                placeholder="What does this field contain?"
                value={form.description}
                onChange={e => setForm(f => ({ ...f, description: e.target.value }))}
              />
            </div>
            {!editingField && (
              <p className="text-xs text-muted-foreground flex items-center gap-1.5">
                <CheckCircle2 className="h-3.5 w-3.5 text-green-600" />
                Manually added requirements are automatically confirmed.
              </p>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowForm(false)}>Cancel</Button>
            <Button
              onClick={handleSave}
              disabled={createMutation.isPending || updateMutation.isPending}
            >
              {editingField ? 'Update' : 'Add'} Requirement
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete confirmation */}
      <AlertDialog open={deleteId !== null} onOpenChange={() => setDeleteId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remove Requirement?</AlertDialogTitle>
            <AlertDialogDescription>
              This requirement will be removed from the destination schema. If analysis has already been run, it will be marked outdated.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground"
              onClick={() => { if (deleteId) deleteMutation.mutate({ id: deleteId, projectId }); setDeleteId(null); }}
            >
              Remove
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}