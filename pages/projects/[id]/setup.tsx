import {
  usePageTitle,
  useParams,
  useNavigate,
  useServerMutation,
  captureError,
} from '@aha-app/builder-core';
import {
  useGetProject,
  useGetDestinationFields,
  useGetSourceFiles,
  useGetReferenceFiles,
  updateProject,
  updateProjectSetup,
  importSourceFile,
  importReferenceFile,
  deleteReferenceFile,
  createDestinationField,
  updateDestinationField,
  deleteDestinationField,
  confirmRequirement,
  bulkConfirmRequirements,
  suggestRequirementsFromTemplate,
  autoMapFields,
  analyzeRecords,
} from '@/server';
import AppHeader from '@/components/AppHeader';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Switch } from '@/components/ui/switch';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@/components/ui/collapsible';
import {
  CheckCircle2,
  ArrowRight,
  Upload,
  Sparkles,
  ShieldCheck,
  Database,
  Link2,
  Users,
  AlertCircle,
  CheckCheck,
  SkipForward,
  ChevronDown,
  ChevronRight,
  Trash2,
  Plus,
  Info,
  FileSpreadsheet,
  Zap,
  Settings2,
  Eye,
  X,
} from 'lucide-react';
import { useState, useRef, useEffect } from 'react';
import { toast } from 'sonner';
import { read as xlsxRead, utils as xlsxUtils } from 'xlsx';
import type { DestinationField } from '@/db/schema';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog';

// ─── Constants ──────────────────────────────────────────────────────────────

const STEPS = [
  { id: 1, label: 'Migration Details', icon: Users },
  { id: 2, label: 'Destination Requirements', icon: ShieldCheck },
  { id: 3, label: 'Reference Data', icon: Database },
  { id: 4, label: 'Source Data', icon: Upload },
  { id: 5, label: 'Field Mapping', icon: Link2 },
  { id: 6, label: 'Ready to Analyze', icon: Zap },
];

const FIELD_TYPES: DestinationField['fieldType'][] = [
  'text', 'number', 'email', 'date', 'boolean', 'enum_type', 'currency', 'identifier',
];

const FIELD_TYPE_LABELS: Record<string, string> = {
  text: 'Text',
  number: 'Number',
  email: 'Email',
  date: 'Date',
  boolean: 'Yes/No',
  enum_type: 'List of Values',
  currency: 'Currency',
  identifier: 'Identifier',
};

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
        result.push(current.trim()); current = '';
      } else { current += ch; }
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

// ─── Setup Stepper ───────────────────────────────────────────────────────────

function SetupStepper({
  currentStep,
  completedSteps,
  onStepClick,
}: {
  currentStep: number;
  completedSteps: Set<number>;
  onStepClick: (step: number) => void;
}) {
  return (
    <div className="flex items-center gap-0 mb-8 overflow-x-auto pb-2">
      {STEPS.map((step, idx) => {
        const isDone = completedSteps.has(step.id);
        const isCurrent = currentStep === step.id;
        const isReachable = step.id <= currentStep || isDone;
        return (
          <div key={step.id} className="flex items-center">
            <button
              onClick={() => isReachable ? onStepClick(step.id) : undefined}
              disabled={!isReachable}
              className={`flex items-center gap-2 px-3 py-2 rounded-lg transition-colors text-sm whitespace-nowrap
                ${isCurrent ? 'bg-primary text-primary-foreground font-semibold' : ''}
                ${isDone && !isCurrent ? 'text-green-700 cursor-pointer hover:bg-green-50' : ''}
                ${!isDone && !isCurrent && isReachable ? 'text-muted-foreground cursor-pointer hover:bg-muted' : ''}
                ${!isReachable ? 'text-muted-foreground/40 cursor-not-allowed' : ''}
              `}
            >
              <div className={`h-6 w-6 rounded-full flex items-center justify-center shrink-0 text-xs font-bold
                ${isCurrent ? 'bg-primary-foreground text-primary' : ''}
                ${isDone && !isCurrent ? 'bg-green-600 text-white' : ''}
                ${!isDone && !isCurrent ? 'border-2 border-current' : ''}
              `}>
                {isDone && !isCurrent ? <CheckCircle2 className="h-3.5 w-3.5" /> : step.id}
              </div>
              <span className="hidden sm:block">{step.label}</span>
            </button>
            {idx < STEPS.length - 1 && (
              <ChevronRight className="h-4 w-4 text-muted-foreground/40 mx-1 shrink-0" />
            )}
          </div>
        );
      })}
    </div>
  );
}

// ─── Step 1: Migration Details ───────────────────────────────────────────────

function Step1Details({
  project,
  projectId,
  onNext,
}: {
  project: { name: string; sourceOrg: string; destinationOrg: string; description?: string | null; stakeholders?: string | null };
  projectId: number;
  onNext: () => void;
}) {
  const [form, setForm] = useState({
    name: project.name,
    sourceOrg: project.sourceOrg,
    destinationOrg: project.destinationOrg,
    description: project.description ?? '',
    stakeholders: project.stakeholders ?? '',
  });

  const projectQuery = useGetProject({ id: projectId });
  const updateMutation = useServerMutation(updateProject, {
    query: projectQuery,
    onSuccess: () => onNext(),
    onError: () => toast.error('Failed to save details'),
  });

  const handleContinue = () => {
    if (!form.name.trim() || !form.sourceOrg.trim() || !form.destinationOrg.trim()) {
      toast.error('Please fill in all required fields');
      return;
    }
    updateMutation.mutate({ id: projectId, ...form, description: form.description || undefined, stakeholders: form.stakeholders || undefined });
  };

  return (
    <div className="max-w-2xl">
      <div className="mb-6">
        <h2 className="text-2xl font-bold mb-1">Migration Details</h2>
        <p className="text-muted-foreground">Tell us about this migration — where data is coming from, where it's going, and who's involved.</p>
      </div>
      <Card>
        <CardContent className="space-y-5 pt-6">
          <div className="space-y-2">
            <Label>Migration Name <span className="text-destructive">*</span></Label>
            <Input
              placeholder="e.g., North America CRM Migration Q1 2027"
              value={form.name}
              onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
            />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label>Source Organization <span className="text-destructive">*</span></Label>
              <Input
                placeholder="e.g., Legacy CRM"
                value={form.sourceOrg}
                onChange={e => setForm(f => ({ ...f, sourceOrg: e.target.value }))}
              />
              <p className="text-xs text-muted-foreground">Where data is coming from</p>
            </div>
            <div className="space-y-2">
              <Label>Destination Organization <span className="text-destructive">*</span></Label>
              <Input
                placeholder="e.g., Salesforce"
                value={form.destinationOrg}
                onChange={e => setForm(f => ({ ...f, destinationOrg: e.target.value }))}
              />
              <p className="text-xs text-muted-foreground">Where data is going</p>
            </div>
          </div>
          <div className="space-y-2">
            <Label>Description</Label>
            <Textarea
              placeholder="Describe the scope and goals of this migration"
              value={form.description}
              onChange={e => setForm(f => ({ ...f, description: e.target.value }))}
              rows={3}
            />
          </div>
          <div className="space-y-2">
            <Label>Migration Stakeholders</Label>
            <Input
              placeholder="e.g., Jane Smith, IT Lead; john@company.com, Data Owner"
              value={form.stakeholders}
              onChange={e => setForm(f => ({ ...f, stakeholders: e.target.value }))}
            />
            <p className="text-xs text-muted-foreground">Names or email addresses of key people involved (optional)</p>
          </div>
        </CardContent>
      </Card>
      <div className="flex justify-end mt-6">
        <Button onClick={handleContinue} disabled={updateMutation.isPending} size="lg">
          {updateMutation.isPending ? 'Saving…' : 'Continue'}
          <ArrowRight className="h-4 w-4" />
        </Button>
      </div>
    </div>
  );
}

// ─── Allowed Values Inline Editor ──────────────────────────────────────────

function AllowedValuesEditor({
  field,
  onUpdate,
}: {
  field: DestinationField;
  onUpdate: (values: string[]) => void;
}) {
  const [newValue, setNewValue] = useState('');
  const values = field.allowedValues ?? [];

  const addValue = () => {
    const v = newValue.trim();
    if (!v || values.includes(v)) return;
    onUpdate([...values, v]);
    setNewValue('');
  };

  const removeValue = (v: string) => {
    onUpdate(values.filter(x => x !== v));
  };

  return (
    <div className="mt-1.5 space-y-1 min-w-[160px]">
      <div className="flex flex-wrap gap-1 min-h-[20px]">
        {values.map(v => (
          <span
            key={v}
            className="inline-flex items-center gap-0.5 bg-secondary/30 text-[10px] rounded px-1.5 py-0.5 font-medium"
          >
            {v}
            <button
              type="button"
              onClick={() => removeValue(v)}
              className="text-muted-foreground hover:text-destructive cursor-pointer ml-0.5"
            >
              <X className="h-2.5 w-2.5" />
            </button>
          </span>
        ))}
        {values.length === 0 && (
          <span className="text-[10px] text-muted-foreground italic">No values — add below</span>
        )}
      </div>
      <div className="flex gap-1">
        <Input
          className="h-6 text-[10px] px-1.5 py-0 min-w-0 flex-1"
          placeholder="Add value…"
          value={newValue}
          onChange={e => setNewValue(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); addValue(); } }}
        />
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="h-6 w-6 shrink-0"
          onClick={addValue}
          title="Add value"
        >
          <Plus className="h-3 w-3" />
        </Button>
      </div>
    </div>
  );
}

// ─── Step 2: Destination Requirements ───────────────────────────────────────

function SuggestionReasoningPopover({ field }: { field: DestinationField }) {
  if (field.requirementSource !== 'ai_suggested') return null;
  if (!field.suggestionReasoning && !field.observedSampleValues?.length) return null;
  const parts = (field.suggestionReasoning ?? '').split(' | Required: ');
  return (
    <Popover>
      <PopoverTrigger asChild>
        <button className="inline-flex items-center gap-1 text-[9px] text-secondary-foreground hover:text-foreground cursor-pointer border border-secondary/40 bg-secondary/10 hover:bg-secondary/20 rounded px-1.5 py-0.5 transition-colors">
          <Eye className="h-2.5 w-2.5" />
          Why?
        </button>
      </PopoverTrigger>
      <PopoverContent side="left" align="start" className="w-72 text-xs">
        <div className="space-y-2">
          <p className="font-semibold flex items-center gap-1.5"><Sparkles className="h-3 w-3" /> AI Suggestion Reasoning</p>
          {parts[0] && <p className="text-muted-foreground leading-relaxed">{parts[0]}</p>}
          {field.observedSampleValues?.length ? (
            <div>
              <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider mb-1">Observed Values</p>
              <div className="flex flex-wrap gap-1">
                {field.observedSampleValues.slice(0, 8).map((v, i) => (
                  <span key={i} className="bg-muted text-muted-foreground rounded px-1.5 py-0.5 text-[10px] font-mono">{v}</span>
                ))}
              </div>
            </div>
          ) : null}
          <p className="text-[10px] text-muted-foreground pt-1 border-t border-border">Review and verify before use in analysis.</p>
        </div>
      </PopoverContent>
    </Popover>
  );
}

type FieldForm = {
  fieldName: string;
  fieldType: DestinationField['fieldType'];
  required: boolean;
  isUnique: boolean;
  allowedValues: string;
  description: string;
};

function Step2Requirements({
  projectId,
  onNext,
}: {
  projectId: number;
  onNext: () => void;
}) {
  const fieldsQuery = useGetDestinationFields({ projectId });
  const fields = fieldsQuery.data ?? [];
  const [isSuggestingFromFile, setIsSuggestingFromFile] = useState(false);
  const templateInputRef = useRef<HTMLInputElement>(null);
  const [showAddForm, setShowAddForm] = useState(false);
  const [addForm, setAddForm] = useState<FieldForm>({ fieldName: '', fieldType: 'text', required: false, isUnique: false, allowedValues: '', description: '' });

  const confirmed = fields.filter(f => f.isConfirmed);
  const aiSuggested = fields.filter(f => f.requirementSource === 'ai_suggested' && !f.isConfirmed);

  const suggestMutation = useServerMutation(suggestRequirementsFromTemplate, {
    query: fieldsQuery,
    onSuccess: (r) => toast.success(r.suggested > 0 ? `AI suggested ${r.suggested} requirement(s) — review below` : 'No new requirements to suggest'),
    onError: () => toast.error('Failed to analyze template'),
    refetchOnSuccess: true,
  });

  const createMutation = useServerMutation(createDestinationField, {
    query: fieldsQuery,
    onSuccess: () => { setShowAddForm(false); setAddForm({ fieldName: '', fieldType: 'text', required: false, isUnique: false, allowedValues: '', description: '' }); toast.success('Requirement added'); },
    onError: (err) => toast.error(err instanceof Error ? err.message : 'Failed to add requirement'),
  });

  const confirmMutation = useServerMutation(confirmRequirement, {
    query: fieldsQuery,
    optimistic: (prev, input) => prev?.map(f => f.id === input.id ? { ...f, isConfirmed: true } : f),
    onError: () => toast.error('Failed to verify requirement'),
  });

  const bulkConfirmMutation = useServerMutation(bulkConfirmRequirements, {
    query: fieldsQuery,
    onSuccess: (r) => toast.success(`Verified ${r.confirmed} suggestion(s)`),
    onError: () => toast.error('Failed to verify requirements'),
    refetchOnSuccess: true,
  });

  const updateMutation = useServerMutation(updateDestinationField, {
    query: fieldsQuery,
    optimistic: (prev, input) => prev?.map(f => f.id === input.id ? { ...f, ...input } : f),
    onError: () => toast.error('Failed to update requirement'),
    refetchOnSuccess: true,
  });

  const deleteMutation = useServerMutation(deleteDestinationField, {
    query: fieldsQuery,
    optimistic: (prev, input) => prev?.filter(f => f.id !== input.id),
    onError: () => toast.error('Failed to remove requirement'),
  });

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
      const sampleRows = jsonData.slice(0, 20).map(row =>
        Object.fromEntries(Object.entries(row).map(([k, v]) => [k, String(v ?? '')]))
      );
      suggestMutation.mutate({ projectId, headers, sampleRows });
    } catch (err) {
      captureError(err);
      toast.error('Failed to read file');
    } finally {
      setIsSuggestingFromFile(false);
    }
  };

  return (
    <div className="max-w-4xl">
      <div className="mb-6">
        <h2 className="text-2xl font-bold mb-1">Destination Requirements</h2>
        <p className="text-muted-foreground">
          Before evaluating source data, MergeFlow needs to understand what the destination system accepts.
          Define the fields the destination expects — their types, whether they're required, and any constraints.
        </p>
      </div>

      {/* Upload card */}
      <div className="grid grid-cols-2 gap-4 mb-6">
        <Card className="border-2 border-dashed hover:border-primary/40 transition-colors">
          <CardContent className="p-5">
            <div className="flex items-start gap-3">
              <div className="h-10 w-10 rounded-lg bg-primary/10 flex items-center justify-center shrink-0">
                <FileSpreadsheet className="h-5 w-5 text-primary" />
              </div>
              <div className="flex-1 min-w-0">
                <h3 className="font-semibold text-sm mb-1">Upload Destination Template</h3>
                <p className="text-xs text-muted-foreground mb-3">
                  Upload a CSV or Excel export from the destination system. MergeFlow will analyze the columns and suggest requirements automatically.
                </p>
                <input type="file" accept=".csv,.xlsx,.xls" ref={templateInputRef} onChange={handleTemplateFile} className="hidden" />
                <Button variant="outline" size="sm" onClick={() => templateInputRef.current?.click()}
                  disabled={isSuggestingFromFile || suggestMutation.isPending}>
                  <Sparkles className="h-4 w-4" />
                  {isSuggestingFromFile || suggestMutation.isPending ? 'Analyzing…' : 'Choose Template File'}
                </Button>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-5">
            <div className="flex items-start gap-3">
              <div className="h-10 w-10 rounded-lg bg-secondary/30 flex items-center justify-center shrink-0">
                <Info className="h-5 w-5 text-secondary-foreground" />
              </div>
              <div>
                <h3 className="font-semibold text-sm mb-1">How it works</h3>
                <ul className="text-xs text-muted-foreground space-y-1">
                  <li>• AI infers field types, constraints, and whether fields are required</li>
                  <li>• All AI suggestions are labeled and require your <strong>explicit verification</strong></li>
                  <li>• Use the <strong>Why?</strong> button to see AI reasoning before verifying</li>
                  <li>• You can also add requirements manually</li>
                </ul>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Pending AI suggestions action */}
      {aiSuggested.length > 0 && (
        <div className="flex items-start gap-3 p-4 rounded-lg border border-yellow-200 bg-yellow-50 mb-4">
          <Sparkles className="h-5 w-5 text-yellow-700 shrink-0 mt-0.5" />
          <div className="flex-1 min-w-0">
            <p className="text-sm font-medium text-yellow-900">
              {aiSuggested.length} AI-suggested requirement{aiSuggested.length !== 1 ? 's' : ''} awaiting your review
            </p>
            <p className="text-xs text-yellow-700 mt-0.5">
              Review each suggestion using the <strong>Why?</strong> button to understand the reasoning. Verify ones you agree with, or edit them first.
            </p>
          </div>
          <Button size="sm" onClick={() => bulkConfirmMutation.mutate({ projectId, fieldIds: aiSuggested.map(f => f.id) })}
            disabled={bulkConfirmMutation.isPending} className="shrink-0">
            <CheckCheck className="h-4 w-4" />
            Verify All Suggestions
          </Button>
        </div>
      )}

      {/* Requirements table */}
      <Card className="mb-6">
        <CardHeader className="pb-3 flex flex-row items-center justify-between">
          <div>
            <CardTitle>Requirements ({fields.length})</CardTitle>
            <CardDescription>
              {fields.length === 0
                ? 'No requirements yet — upload a template or add manually'
                : `${confirmed.length} verified, ${aiSuggested.length} pending review`}
            </CardDescription>
          </div>
          <Button size="sm" onClick={() => setShowAddForm(true)}>
            <Plus className="h-4 w-4" />
            Add Manually
          </Button>
        </CardHeader>
        <CardContent className="p-0">
          {fields.length === 0 ? (
            <div className="text-center py-10 text-muted-foreground">
              <ShieldCheck className="h-10 w-10 mx-auto mb-3 opacity-20" />
              <p className="text-sm font-medium mb-1">No requirements defined yet</p>
              <p className="text-xs">Upload a destination template above, or add requirements manually.</p>
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-36">Field Name</TableHead>
                  <TableHead className="w-28">Required</TableHead>
                  <TableHead className="w-24">Unique</TableHead>
                  <TableHead>Type &amp; Values</TableHead>
                  <TableHead className="w-28">Source</TableHead>
                  <TableHead className="w-24">Verified</TableHead>
                  <TableHead className="w-24"></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {fields.map(field => (
                  <TableRow key={field.id} className={!field.isConfirmed ? 'bg-yellow-50/40' : ''}>
                    <TableCell className="font-medium text-sm align-top pt-3">
                      {field.fieldName}
                      {field.description && (
                        <span className="block text-[10px] text-muted-foreground truncate max-w-[130px]">{field.description}</span>
                      )}
                    </TableCell>
                    <TableCell className="align-top pt-3">
                      {/* Obvious Required checkbox with label */}
                      <button
                        type="button"
                        onClick={() => updateMutation.mutate({ id: field.id, projectId, required: !field.required })}
                        className="cursor-pointer flex items-center gap-1.5 group"
                        title="Click to toggle Required / Optional"
                      >
                        <div className={`h-4 w-4 rounded border-2 flex items-center justify-center shrink-0 transition-colors
                          ${field.required ? 'bg-red-600 border-red-600' : 'bg-white border-muted-foreground/40 group-hover:border-muted-foreground'}`}>
                          {field.required && <CheckCircle2 className="h-2.5 w-2.5 text-white" />}
                        </div>
                        <span className={`text-xs font-medium ${field.required ? 'text-red-700' : 'text-muted-foreground'}`}>
                          {field.required ? 'Required' : 'Optional'}
                        </span>
                      </button>
                    </TableCell>
                    <TableCell className="align-top pt-3">
                      {/* Unique toggle */}
                      <button
                        type="button"
                        onClick={() => updateMutation.mutate({ id: field.id, projectId, isUnique: !field.isUnique })}
                        className="cursor-pointer flex items-center gap-1.5 group"
                        title="Click to toggle Unique constraint"
                      >
                        <div className={`h-4 w-4 rounded border-2 flex items-center justify-center shrink-0 transition-colors
                          ${field.isUnique ? 'bg-blue-600 border-blue-600' : 'bg-white border-muted-foreground/40 group-hover:border-muted-foreground'}`}>
                          {field.isUnique && <CheckCircle2 className="h-2.5 w-2.5 text-white" />}
                        </div>
                        <span className={`text-xs font-medium ${field.isUnique ? 'text-blue-700' : 'text-muted-foreground'}`}>
                          {field.isUnique ? 'Unique' : '—'}
                        </span>
                      </button>
                    </TableCell>
                    <TableCell className="align-top pt-2">
                      {/* Inline type selector */}
                      <Select
                        value={field.fieldType}
                        onValueChange={v => updateMutation.mutate({ id: field.id, projectId, fieldType: v as DestinationField['fieldType'] })}
                      >
                        <SelectTrigger className="h-7 text-xs w-[130px] border-transparent hover:border-border">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {FIELD_TYPES.map(t => (
                            <SelectItem key={t} value={t}>{FIELD_TYPE_LABELS[t]}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      {/* Inline allowed values editor for List of Values */}
                      {field.fieldType === 'enum_type' && (
                        <AllowedValuesEditor
                          field={field}
                          onUpdate={(values) => updateMutation.mutate({ id: field.id, projectId, allowedValues: values })}
                        />
                      )}
                    </TableCell>
                    <TableCell className="align-top pt-3">
                      {field.requirementSource === 'ai_suggested' ? (
                        <div className="flex items-center gap-1">
                          <Badge variant="outline" className="text-[9px] px-1.5 bg-secondary/20 text-secondary-foreground border-secondary/30 gap-1">
                            <Sparkles className="h-2.5 w-2.5" /> AI Suggested
                          </Badge>
                          <SuggestionReasoningPopover field={field} />
                        </div>
                      ) : (
                        <Badge variant="outline" className="text-[9px] px-1.5 bg-blue-50 text-blue-700 border-blue-200">Manual</Badge>
                      )}
                    </TableCell>
                    <TableCell className="align-top pt-3">
                      {field.isConfirmed ? (
                        <Badge variant="outline" className="text-[9px] px-1.5 bg-green-50 text-green-700 border-green-200 gap-1">
                          <CheckCircle2 className="h-2.5 w-2.5" /> Verified
                        </Badge>
                      ) : (
                        <Badge variant="outline" className="text-[9px] px-1.5 bg-yellow-50 text-yellow-700 border-yellow-200">Pending</Badge>
                      )}
                    </TableCell>
                    <TableCell className="align-top pt-2">
                      <div className="flex items-center gap-1">
                        {!field.isConfirmed && (
                          <Button variant="ghost" size="sm" className="h-7 px-2 text-[10px] text-green-700 hover:bg-green-50"
                            onClick={() => confirmMutation.mutate({ id: field.id, projectId })}
                            disabled={confirmMutation.isPending}>
                            <CheckCircle2 className="h-3 w-3" /> Verify
                          </Button>
                        )}
                        <Button variant="ghost" size="icon" className="h-7 w-7 text-muted-foreground hover:text-destructive"
                          onClick={() => deleteMutation.mutate({ id: field.id, projectId })}>
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

      {/* Add form dialog */}
      <Dialog open={showAddForm} onOpenChange={setShowAddForm}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader><DialogTitle>Add Destination Requirement</DialogTitle></DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label>Field Name <span className="text-destructive">*</span></Label>
              <Input placeholder="e.g., Email Address" value={addForm.fieldName} onChange={e => setAddForm(f => ({ ...f, fieldName: e.target.value }))} />
            </div>
            <div className="space-y-2">
              <Label>Data Type</Label>
              <Select value={addForm.fieldType} onValueChange={v => setAddForm(f => ({ ...f, fieldType: v as DestinationField['fieldType'] }))}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {FIELD_TYPES.map(t => <SelectItem key={t} value={t}>{FIELD_TYPE_LABELS[t]}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="flex items-center gap-6">
              <div className="flex items-center gap-2">
                <Switch checked={addForm.required} onCheckedChange={v => setAddForm(f => ({ ...f, required: v }))} />
                <Label>Required</Label>
              </div>
              <div className="flex items-center gap-2">
                <Switch checked={addForm.isUnique} onCheckedChange={v => setAddForm(f => ({ ...f, isUnique: v }))} />
                <Label>Must be unique</Label>
              </div>
            </div>
            <div className="space-y-2">
              <Label>Allowed Values <span className="text-xs text-muted-foreground font-normal">(comma-separated, for fixed lists only)</span></Label>
              <Input placeholder="e.g., Active, Inactive, Pending" value={addForm.allowedValues} onChange={e => setAddForm(f => ({ ...f, allowedValues: e.target.value }))} />
            </div>
            <div className="space-y-2">
              <Label>Description <span className="text-xs text-muted-foreground font-normal">(optional)</span></Label>
              <Input placeholder="What does this field contain?" value={addForm.description} onChange={e => setAddForm(f => ({ ...f, description: e.target.value }))} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowAddForm(false)}>Cancel</Button>
            <Button onClick={() => {
              if (!addForm.fieldName.trim()) { toast.error('Field name required'); return; }
              createMutation.mutate({
                projectId,
                fieldName: addForm.fieldName.trim(),
                fieldType: addForm.fieldType,
                required: addForm.required,
                isUnique: addForm.isUnique,
                allowedValues: addForm.allowedValues.trim() ? addForm.allowedValues.split(',').map(v => v.trim()).filter(Boolean) : undefined,
                description: addForm.description.trim() || undefined,
                requirementSource: 'manual',
                isConfirmed: true,
              });
            }} disabled={createMutation.isPending}>
              Add Requirement
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <div className="flex justify-between items-center mt-6">
        <p className="text-xs text-muted-foreground">
          {fields.length === 0 ? 'You can continue without requirements, but analysis accuracy will be limited.' : `${confirmed.length} verified requirement${confirmed.length !== 1 ? 's' : ''} ready for analysis.`}
        </p>
        <Button onClick={onNext} size="lg">
          Continue
          <ArrowRight className="h-4 w-4" />
        </Button>
      </div>
    </div>
  );
}

// ─── Step 3: Destination Reference Data ─────────────────────────────────────

function Step3ReferenceData({
  projectId,
  onNext,
  onSkip,
}: {
  projectId: number;
  onNext: () => void;
  onSkip: () => void;
}) {
  const refFilesQuery = useGetReferenceFiles({ projectId });
  const refFiles = refFilesQuery.data ?? [];
  const fieldsQuery = useGetDestinationFields({ projectId });
  const destFields = fieldsQuery.data ?? [];
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [uploadError, setUploadError] = useState<string | null>(null);

  const deleteMutation = useServerMutation(deleteReferenceFile, {
    query: refFilesQuery,
    optimistic: (prev, input) => prev?.filter(f => f.id !== input.id),
    onError: () => toast.error('Failed to remove reference data'),
  });

  const importMutation = useServerMutation(importReferenceFile, {
    query: refFilesQuery,
    onSuccess: () => { toast.success('Reference data loaded'); setUploadError(null); },
    onError: (err) => {
      const msg = err instanceof Error ? err.message : 'Failed to load reference data';
      setUploadError(msg);
      toast.error(msg);
    },
    refetchOnSuccess: true,
  });

  const handleFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploadError(null);
    try {
      const text = await file.text();
      const { columns, rows } = parseCSV(text);
      if (rows.length === 0) {
        setUploadError('No data rows found in file. Make sure the CSV has a header row and at least one data row.');
        toast.error('No data rows found');
        return;
      }
      importMutation.mutate({ projectId, fileName: file.name, columns, rows });
    } catch (err) {
      captureError(err);
      const msg = 'Failed to read file — make sure it is a valid CSV';
      setUploadError(msg);
      toast.error(msg);
    }
    e.target.value = '';
  };

  // Compute mapping status for a reference file
  const computeMappingStatus = (file: typeof refFiles[0]) => {
    if (destFields.length === 0) return null;
    const destNorm = new Set(destFields.map(f => f.fieldName.toLowerCase().replace(/[\s_-]/g, '')));
    const matched = (file.columns ?? []).filter(col => destNorm.has(col.toLowerCase().replace(/[\s_-]/g, '')));
    return { matched: matched.length, total: destFields.length };
  };

  const totalRefRecords = refFiles.reduce((sum, f) => sum + f.rowCount, 0);
  const hasPersistedRecords = totalRefRecords > 0;

  return (
    <div className="max-w-2xl">
      <div className="mb-6">
        <h2 className="text-2xl font-bold mb-1">Destination Reference Data</h2>
        <p className="text-muted-foreground">
          Optionally upload a CSV of records that already exist in the destination system.
          MergeFlow uses this to identify whether incoming source records may already be present — enabling cross-system duplicate detection.
        </p>
      </div>

      <div className="flex items-start gap-3 p-4 rounded-lg border border-blue-200 bg-blue-50 mb-6">
        <Info className="h-5 w-5 text-blue-600 shrink-0 mt-0.5" />
        <div>
          <p className="text-sm font-medium text-blue-900">Why upload reference data?</p>
          <p className="text-xs text-blue-700 mt-1">
            If a record in your source file already exists in the destination (e.g., a customer migrated earlier),
            MergeFlow can flag it as a potential cross-system duplicate.
            <strong> Skipping this step means cross-system duplicate detection will be unavailable.</strong>
          </p>
        </div>
      </div>

      {/* Upload error */}
      {uploadError && (
        <div className="flex items-start gap-3 p-3 rounded-lg border border-red-200 bg-red-50 mb-4">
          <AlertCircle className="h-4 w-4 text-red-600 shrink-0 mt-0.5" />
          <p className="text-sm text-red-800">{uploadError}</p>
        </div>
      )}

      {refFiles.length === 0 ? (
        <Card className="border-2 border-dashed hover:border-primary/40 transition-colors mb-6">
          <CardContent className="flex flex-col items-center justify-center p-10 text-center">
            <Database className="h-10 w-10 text-muted-foreground mb-3" />
            <h3 className="font-semibold mb-1">No reference data loaded</h3>
            <p className="text-sm text-muted-foreground mb-4">
              Export existing records from your destination system as a CSV and upload it here.
            </p>
            <input type="file" accept=".csv" ref={fileInputRef} onChange={handleFile} className="hidden" />
            <Button variant="outline" onClick={() => fileInputRef.current?.click()} disabled={importMutation.isPending}>
              <Upload className="h-4 w-4" />
              {importMutation.isPending ? 'Loading…' : 'Upload Reference CSV'}
            </Button>
          </CardContent>
        </Card>
      ) : (
        <Card className="mb-6">
          <CardContent className="p-5">
            <div className="flex items-center gap-3 mb-4">
              <CheckCircle2 className="h-6 w-6 text-green-600" />
              <div>
                <p className="font-semibold text-green-800">Reference data loaded</p>
                <p className="text-xs text-muted-foreground">
                  {hasPersistedRecords
                    ? 'Cross-system duplicate detection is enabled'
                    : 'No records persisted — cross-system detection unavailable'}
                </p>
              </div>
            </div>
            <div className="space-y-3">
              {refFiles.map(file => {
                const mapping = computeMappingStatus(file);
                return (
                  <div key={file.id} className="p-3 rounded-lg bg-muted/40 border border-border">
                    <div className="flex items-center gap-3">
                      <FileSpreadsheet className="h-4 w-4 text-muted-foreground shrink-0" />
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium truncate">{file.fileName}</p>
                        <p className="text-xs text-muted-foreground">
                          {file.rowCount.toLocaleString()} destination reference records loaded
                        </p>
                        {mapping && (
                          <p className={`text-xs mt-0.5 ${mapping.matched > 0 ? 'text-green-700' : 'text-yellow-700'}`}>
                            {mapping.matched > 0
                              ? `✓ Field mapping: ${mapping.matched} of ${mapping.total} destination fields matched`
                              : `⚠️ Field mapping: columns don't match destination fields — check column names`
                            }
                          </p>
                        )}
                      </div>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-7 w-7 text-muted-foreground hover:text-destructive shrink-0"
                        onClick={() => deleteMutation.mutate({ id: file.id, projectId })}
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                  </div>
                );
              })}
            </div>
            <div className="mt-3">
              <input type="file" accept=".csv" ref={fileInputRef} onChange={handleFile} className="hidden" />
              <Button variant="ghost" size="sm" onClick={() => fileInputRef.current?.click()} disabled={importMutation.isPending}>
                <Plus className="h-3.5 w-3.5" /> Add another file
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      <div className="flex justify-between items-center mt-6">
        <Button variant="ghost" onClick={onSkip} className="text-muted-foreground">
          <SkipForward className="h-4 w-4" />
          Skip — no reference data available
        </Button>
        {refFiles.length > 0 && (
          <Button onClick={onNext} size="lg">
            Continue
            <ArrowRight className="h-4 w-4" />
          </Button>
        )}
      </div>
    </div>
  );
}

// ─── Step 4: Source Data ─────────────────────────────────────────────────────

function Step4SourceData({
  projectId,
  onNext,
}: {
  projectId: number;
  onNext: () => void;
}) {
  const filesQuery = useGetSourceFiles({ projectId });
  const files = filesQuery.data ?? [];
  const fileInputRef = useRef<HTMLInputElement>(null);

  const importMutation = useServerMutation(importSourceFile, {
    query: filesQuery,
    onSuccess: () => {
      toast.success('Source data imported — proceeding to field mapping');
      setTimeout(onNext, 800);
    },
    onError: () => toast.error('Failed to import file'),
  });

  const handleFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const text = await file.text();
      const { columns, rows } = parseCSV(text);
      if (rows.length === 0) { toast.error('No data rows found'); return; }
      importMutation.mutate({ projectId, fileName: file.name, columns, rows });
    } catch (err) {
      captureError(err);
      toast.error('Failed to read file');
    }
    e.target.value = '';
  };

  return (
    <div className="max-w-2xl">
      <div className="mb-6">
        <h2 className="text-2xl font-bold mb-1">Source Data</h2>
        <p className="text-muted-foreground">
          Upload the data you want to migrate. This is the incoming source data that MergeFlow will evaluate against your destination requirements.
        </p>
      </div>

      <div className="flex items-start gap-3 p-4 rounded-lg border border-muted bg-muted/30 mb-6">
        <Info className="h-5 w-5 text-muted-foreground shrink-0 mt-0.5" />
        <div className="text-xs text-muted-foreground">
          <p className="font-medium text-foreground mb-1">CSV format expected</p>
          <p>The first row should contain column headers. Each additional row is one record to be evaluated for migration. Maximum ~1,000 rows per file for best performance.</p>
        </div>
      </div>

      {files.length > 0 && (
        <Card className="mb-6">
          <CardContent className="p-5">
            <div className="flex items-center gap-2 mb-3">
              <CheckCircle2 className="h-5 w-5 text-green-600" />
              <p className="font-semibold text-green-800">Source data loaded</p>
            </div>
            <div className="space-y-2">
              {files.map(file => (
                <div key={file.id} className="flex items-center gap-3 p-2 rounded bg-muted/40">
                  <FileSpreadsheet className="h-4 w-4 text-muted-foreground" />
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium truncate">{file.fileName}</p>
                    <p className="text-xs text-muted-foreground">{file.rowCount.toLocaleString()} records · {(file.columns ?? []).length} columns</p>
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      <Card className={`border-2 ${files.length === 0 ? 'border-dashed' : 'border-dashed border-muted'} hover:border-primary/40 transition-colors mb-6`}>
        <CardContent className="flex flex-col items-center justify-center p-10 text-center">
          <Upload className="h-10 w-10 text-muted-foreground mb-3" />
          <h3 className="font-semibold mb-1">{files.length === 0 ? 'Upload source CSV' : 'Upload another file'}</h3>
          <p className="text-sm text-muted-foreground mb-4">
            {files.length === 0 ? 'Select the CSV file containing the records to migrate' : 'Add another source file to include in this migration'}
          </p>
          <input type="file" accept=".csv" ref={fileInputRef} onChange={handleFile} className="hidden" />
          <Button onClick={() => fileInputRef.current?.click()} disabled={importMutation.isPending}
            variant={files.length === 0 ? 'default' : 'outline'}>
            <Upload className="h-4 w-4" />
            {importMutation.isPending ? 'Importing…' : 'Choose CSV File'}
          </Button>
        </CardContent>
      </Card>

      <div className="flex justify-end mt-6">
        {files.length > 0 && (
          <Button onClick={onNext} size="lg">
            Continue to Field Mapping
            <ArrowRight className="h-4 w-4" />
          </Button>
        )}
      </div>
    </div>
  );
}

// ─── Step 5: Field Mapping ───────────────────────────────────────────────────

function Step5FieldMapping({
  projectId,
  onNext,
}: {
  projectId: number;
  onNext: () => void;
}) {
  const fieldsQuery = useGetDestinationFields({ projectId });
  const filesQuery = useGetSourceFiles({ projectId });
  const projectQuery = useGetProject({ id: projectId });
  const fields = fieldsQuery.data ?? [];
  const sourceFiles = filesQuery.data ?? [];
  const project = projectQuery.data;
  const sourceColumns = [...new Set(sourceFiles.flatMap(f => f.columns ?? []))];
  const [autoMapped, setAutoMapped] = useState(false);
  const [showAdvancedRules, setShowAdvancedRules] = useState(false);

  const savedPolicies = (project?.sourceColumnPolicies ?? {}) as Record<string, string>;

  const setupMutation = useServerMutation(updateProjectSetup, {
    query: projectQuery,
    onError: () => toast.error('Failed to save column policies'),
  });

  const updateColumnPolicy = (col: string, policy: string) => {
    const newPolicies = { ...savedPolicies, [col]: policy };
    setupMutation.mutate({ id: projectId, sourceColumnPolicies: newPolicies });
  };

  const autoMapMutation = useServerMutation(autoMapFields, {
    query: fieldsQuery,
    onSuccess: (r) => {
      if (r.mapped > 0) toast.success(`Auto-mapped ${r.mapped} field${r.mapped !== 1 ? 's' : ''} based on matching names`);
    },
    onError: () => {},
    refetchOnSuccess: true,
  });

  const updateMappingMutation = useServerMutation(updateDestinationField, {
    query: fieldsQuery,
    optimistic: (prev, input) => prev?.map(f =>
      f.id === input.id ? { ...f, ...input, status: input.sourceMapping ? 'mapped' : 'missing' as DestinationField['status'] } : f
    ),
    onError: () => toast.error('Failed to update mapping'),
    refetchOnSuccess: true,
  });

  useEffect(() => {
    if (!autoMapped && sourceColumns.length > 0 && fields.length > 0) {
      setAutoMapped(true);
      autoMapMutation.mutate({ projectId });
    }
  }, [sourceColumns.length, fields.length]);

  const mappedFields = fields.filter(f => f.sourceMapping);
  const unmappedDestFields = fields.filter(f => !f.sourceMapping);
  const mappedSourceCols = new Set(fields.map(f => f.sourceMapping).filter(Boolean));
  const sourceOnlyColumns = sourceColumns.filter(col => !mappedSourceCols.has(col));

  return (
    <div className="max-w-4xl">
      <div className="mb-6">
        <h2 className="text-2xl font-bold mb-1">Field Mapping</h2>
        <p className="text-muted-foreground">
          MergeFlow has automatically matched source columns to destination fields where names align. Review and resolve any remaining gaps.
        </p>
      </div>

      {/* Mapping stats */}
      <div className="grid grid-cols-3 gap-4 mb-6">
        <Card>
          <CardContent className="p-4 text-center">
            <div className="text-2xl font-bold text-green-700">{mappedFields.length}</div>
            <div className="text-xs text-muted-foreground">Fields Mapped</div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4 text-center">
            <div className={`text-2xl font-bold ${unmappedDestFields.filter(f => f.required).length > 0 ? 'text-red-600' : 'text-muted-foreground'}`}>
              {unmappedDestFields.length}
            </div>
            <div className="text-xs text-muted-foreground">Destination Fields Unmapped</div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4 text-center">
            <div className="text-2xl font-bold text-muted-foreground">{sourceOnlyColumns.length}</div>
            <div className="text-xs text-muted-foreground">Source-Only Columns</div>
          </CardContent>
        </Card>
      </div>

      {/* Unmapped required fields warning */}
      {unmappedDestFields.filter(f => f.required).length > 0 && (
        <div className="flex items-start gap-3 p-4 rounded-lg border border-red-200 bg-red-50 mb-4">
          <AlertCircle className="h-5 w-5 text-red-600 shrink-0 mt-0.5" />
          <div>
            <p className="text-sm font-medium text-red-900">
              {unmappedDestFields.filter(f => f.required).length} required destination field{unmappedDestFields.filter(f => f.required).length !== 1 ? 's' : ''} need a source column
            </p>
            <p className="text-xs text-red-700 mt-0.5">
              These fields are marked as required by the destination. Records missing them will fail validation.
            </p>
          </div>
        </div>
      )}

      {/* Main mapping table */}
      {fields.length > 0 && (
        <Card className="mb-4">
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Destination Field Mappings</CardTitle>
            <CardDescription>Select which source column provides data for each destination field.</CardDescription>
          </CardHeader>
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Destination Field</TableHead>
                  <TableHead>Required?</TableHead>
                  <TableHead>Source Column</TableHead>
                  <TableHead>Status</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {fields.map(field => (
                  <TableRow key={field.id} className={!field.sourceMapping && field.required ? 'bg-red-50/30' : ''}>
                    <TableCell className="font-medium text-sm">{field.fieldName}</TableCell>
                    <TableCell>
                      {field.required
                        ? <Badge variant="outline" className="text-[9px] px-1.5 bg-red-50 text-red-700 border-red-200">Required</Badge>
                        : <span className="text-[10px] text-muted-foreground">Optional</span>}
                    </TableCell>
                    <TableCell>
                      {sourceColumns.length > 0 ? (
                        <Select
                          value={field.sourceMapping ?? '__none__'}
                          onValueChange={v => updateMappingMutation.mutate({
                            id: field.id, projectId,
                            sourceMapping: v === '__none__' ? null : v,
                          })}
                        >
                          <SelectTrigger className="h-7 text-xs w-[180px]">
                            <div className="flex items-center gap-1.5 min-w-0">
                              <Link2 className={`h-3 w-3 shrink-0 ${field.sourceMapping ? 'text-green-500' : 'text-muted-foreground'}`} />
                              <SelectValue placeholder="Not mapped" />
                            </div>
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="__none__">— Not mapped —</SelectItem>
                            {sourceColumns.map(col => (
                              <SelectItem key={col} value={col}>{col}</SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      ) : (
                        <span className="text-xs text-muted-foreground italic">No source data</span>
                      )}
                    </TableCell>
                    <TableCell>
                      {field.sourceMapping
                        ? <Badge variant="outline" className="text-[9px] px-1.5 bg-green-50 text-green-700 border-green-200 gap-1"><CheckCircle2 className="h-2.5 w-2.5" /> Mapped</Badge>
                        : <Badge variant="outline" className="text-[9px] px-1.5 bg-muted text-muted-foreground">Unmapped</Badge>}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}

      {/* Source-only columns with explanation and policy */}
      {sourceOnlyColumns.length > 0 && (
        <Card className="mb-4">
          <CardHeader className="pb-3">
            <CardTitle className="text-sm">Source-Only Columns ({sourceOnlyColumns.length})</CardTitle>
            <CardDescription className="mt-1 text-xs leading-relaxed">
              Source-only fields exist in the incoming source data but do not have a destination field.
              MergeFlow preserves them for analysis, lineage, and audit, but they are{' '}
              <strong>not exported to the destination</strong> unless you explicitly map them.
              You can set a per-column policy below, or leave the defaults.
            </CardDescription>
          </CardHeader>
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Column</TableHead>
                  <TableHead>Policy</TableHead>
                  <TableHead>Export Status</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {sourceOnlyColumns.map(col => {
                  const policy = savedPolicies[col] ?? 'keep';
                  return (
                    <TableRow key={col}>
                      <TableCell className="font-mono text-sm">{col}</TableCell>
                      <TableCell>
                        <Select
                          value={policy}
                          onValueChange={v => updateColumnPolicy(col, v)}
                        >
                          <SelectTrigger className="h-7 text-xs w-[170px]">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="keep">Keep as context</SelectItem>
                            <SelectItem value="ignore">Ignore</SelectItem>
                            <SelectItem value="review">Review when populated</SelectItem>
                          </SelectContent>
                        </Select>
                      </TableCell>
                      <TableCell>
                        {policy === 'keep' && (
                          <span className="text-xs text-muted-foreground">Source-only · Keep as context · Not exported</span>
                        )}
                        {policy === 'ignore' && (
                          <span className="text-xs text-muted-foreground">Ignored · Not exported</span>
                        )}
                        {policy === 'review' && (
                          <span className="text-xs text-yellow-700">Flagged for review when populated · Not exported</span>
                        )}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}

      {/* Advanced rules collapsible */}
      <Collapsible open={showAdvancedRules} onOpenChange={setShowAdvancedRules}>
        <CollapsibleTrigger asChild>
          <Button variant="ghost" size="sm" className="text-muted-foreground mb-2">
            <Settings2 className="h-4 w-4" />
            Advanced Rules
            {showAdvancedRules ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
          </Button>
        </CollapsibleTrigger>
        <CollapsibleContent>
          <Card className="mb-4 border-dashed">
            <CardContent className="p-4">
              <p className="text-xs text-muted-foreground">
                Advanced validation rules (regex patterns, cross-field constraints, etc.) can be configured after setup in the <strong>Field Mapping &amp; Rules</strong> page. Most business users can skip this for now.
              </p>
            </CardContent>
          </Card>
        </CollapsibleContent>
      </Collapsible>

      <div className="flex justify-between items-center mt-4">
        <p className="text-xs text-muted-foreground">
          Unmapped optional fields are not errors — they simply won't be validated against destination requirements.
        </p>
        <Button onClick={onNext} size="lg">
          Continue
          <ArrowRight className="h-4 w-4" />
        </Button>
      </div>
    </div>
  );
}

// ─── Step 6: Ready to Analyze ────────────────────────────────────────────────

function Step6ReadyToAnalyze({
  projectId,
  project,
  onAnalyze,
}: {
  projectId: number;
  project: { name: string; sourceOrg: string; destinationOrg: string };
  onAnalyze: () => void;
}) {
  const fieldsQuery = useGetDestinationFields({ projectId });
  const filesQuery = useGetSourceFiles({ projectId });
  const refFilesQuery = useGetReferenceFiles({ projectId });
  const fields = fieldsQuery.data ?? [];
  const sourceFiles = filesQuery.data ?? [];
  const refFiles = refFilesQuery.data ?? [];

  const verifiedFields = fields.filter(f => f.isConfirmed);
  const mappedFields = fields.filter(f => f.sourceMapping);
  const totalRecords = sourceFiles.reduce((sum, f) => sum + f.rowCount, 0);
  const totalRefRecords = refFiles.reduce((sum, f) => sum + f.rowCount, 0);
  const unmappedRequired = fields.filter(f => f.required && !f.sourceMapping);

  const hasBlockingIssues = unmappedRequired.length > 0;

  const analyzeMutation = useServerMutation(analyzeRecords, {
    onSuccess: (result) => {
      if (result.requirementsWarning) {
        toast.warning(result.requirementsWarning, { duration: 8000 });
      } else {
        toast.success(`Analysis complete — ${result.analyzed} records processed`);
      }
      onAnalyze();
    },
    onError: () => toast.error('Analysis failed'),
  });

  return (
    <div className="max-w-2xl">
      <div className="mb-6">
        <h2 className="text-2xl font-bold mb-1">Ready to Analyze</h2>
        <p className="text-muted-foreground">
          Review your migration setup before running the analysis.
        </p>
      </div>

      <div className="space-y-3 mb-8">
        {/* Requirements */}
        <SummaryRow
          status={verifiedFields.length > 0 ? 'ok' : 'warn'}
          label="Destination Requirements"
          detail={verifiedFields.length > 0
            ? `${verifiedFields.length} verified requirement${verifiedFields.length !== 1 ? 's' : ''}`
            : 'No requirements defined — analysis will run without destination validation'}
        />
        {/* Reference data */}
        <SummaryRow
          status={totalRefRecords > 0 ? 'ok' : 'skip'}
          label="Destination Reference Records"
          detail={totalRefRecords > 0
            ? `${totalRefRecords.toLocaleString()} records loaded — cross-system duplicate detection enabled`
            : 'Skipped — cross-system duplicate detection unavailable'}
        />
        {/* Source records */}
        <SummaryRow
          status={totalRecords > 0 ? 'ok' : 'error'}
          label="Source Records"
          detail={totalRecords > 0
            ? `${totalRecords.toLocaleString()} records ready for analysis`
            : 'No source records loaded — go back and upload source data'}
        />
        {/* Mappings */}
        <SummaryRow
          status={unmappedRequired.length === 0 ? 'ok' : 'error'}
          label="Field Mappings"
          detail={unmappedRequired.length === 0
            ? `${mappedFields.length} of ${fields.length} fields mapped`
            : `${unmappedRequired.length} required field${unmappedRequired.length !== 1 ? 's' : ''} still unmapped: ${unmappedRequired.map(f => f.fieldName).join(', ')}`}
        />
      </div>

      {hasBlockingIssues ? (
        <div className="flex items-start gap-3 p-4 rounded-lg border border-red-200 bg-red-50 mb-6">
          <AlertCircle className="h-5 w-5 text-red-600 shrink-0 mt-0.5" />
          <div>
            <p className="text-sm font-medium text-red-900">Setup has blocking issues</p>
            <p className="text-xs text-red-700 mt-0.5">
              Go back to Field Mapping and resolve the unmapped required fields before running analysis.
            </p>
          </div>
        </div>
      ) : totalRecords === 0 ? (
        <div className="flex items-start gap-3 p-4 rounded-lg border border-red-200 bg-red-50 mb-6">
          <AlertCircle className="h-5 w-5 text-red-600 shrink-0 mt-0.5" />
          <div>
            <p className="text-sm font-medium text-red-900">No source data loaded</p>
            <p className="text-xs text-red-700 mt-0.5">Go back to Source Data and upload a CSV file.</p>
          </div>
        </div>
      ) : null}

      <Button
        size="lg"
        className="w-full"
        onClick={() => analyzeMutation.mutate({ projectId })}
        disabled={analyzeMutation.isPending || hasBlockingIssues || totalRecords === 0}
      >
        <Zap className="h-5 w-5" />
        {analyzeMutation.isPending ? 'Running Analysis…' : 'Run Analysis'}
      </Button>

      <p className="text-xs text-muted-foreground text-center mt-3">
        Analysis evaluates every source record against your destination requirements and detects duplicates.
        This may take a moment depending on the number of records.
      </p>
    </div>
  );
}

function SummaryRow({ status, label, detail }: { status: 'ok' | 'warn' | 'skip' | 'error'; label: string; detail: string }) {
  const iconClass = {
    ok: 'text-green-600',
    warn: 'text-yellow-600',
    skip: 'text-muted-foreground',
    error: 'text-red-600',
  }[status];
  const Icon = status === 'ok' ? CheckCircle2 : status === 'error' ? AlertCircle : status === 'skip' ? SkipForward : AlertCircle;
  const bgClass = {
    ok: 'border-green-200 bg-green-50',
    warn: 'border-yellow-200 bg-yellow-50',
    skip: 'border-border bg-muted/30',
    error: 'border-red-200 bg-red-50',
  }[status];
  return (
    <div className={`flex items-start gap-3 p-4 rounded-lg border ${bgClass}`}>
      <Icon className={`h-5 w-5 shrink-0 mt-0.5 ${iconClass}`} />
      <div>
        <p className="text-sm font-semibold">{label}</p>
        <p className="text-xs text-muted-foreground mt-0.5">{detail}</p>
      </div>
    </div>
  );
}

// ─── Main Setup Page ─────────────────────────────────────────────────────────

export default function SetupPage() {
  const { id } = useParams();
  const projectId = Number(id);
  const navigate = useNavigate();
  usePageTitle('Setup | MergeFlow');

  const projectQuery = useGetProject({ id: projectId });
  const project = projectQuery.data;

  const [currentStep, setCurrentStep] = useState(1);
  const [completedSteps, setCompletedSteps] = useState<Set<number>>(new Set());

  // Initialize step from project's saved setupStep
  useEffect(() => {
    if (project) {
      if (project.setupComplete) {
        navigate(`/projects/${projectId}`);
        return;
      }
      const savedStep = project.setupStep ?? 1;
      setCurrentStep(savedStep);
      // Mark all prior steps as completed
      const done = new Set<number>();
      for (let i = 1; i < savedStep; i++) done.add(i);
      setCompletedSteps(done);
    }
  }, [project?.id, project?.setupComplete]);

  const setupMutation = useServerMutation(updateProjectSetup, {
    query: projectQuery,
  });

  const advanceTo = (step: number) => {
    setCompletedSteps(prev => new Set([...prev, currentStep]));
    setCurrentStep(step);
    setupMutation.mutate({ id: projectId, setupStep: step });
  };

  const handleStepClick = (step: number) => {
    setCurrentStep(step);
  };

  const handleAnalyzeComplete = () => {
    setupMutation.mutate({ id: projectId, setupComplete: true, setupStep: 6 });
    navigate(`/projects/${projectId}`);
  };

  if (!project && !projectQuery.loading) {
    return (
      <div className="min-h-screen bg-background">
        <AppHeader />
        <main className="max-w-4xl mx-auto px-6 py-16 text-center">
          <h2 className="text-2xl font-bold mb-4">Migration not found</h2>
          <Button onClick={() => navigate('/projects')}>Back to Hub</Button>
        </main>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background">
      <AppHeader />
      <main className="max-w-5xl mx-auto px-6 py-8 pb-16">
        {/* Title */}
        <div className="mb-6">
          <div className="flex items-center gap-2 text-xs text-muted-foreground mb-2">
            <button onClick={() => navigate('/projects')} className="hover:text-foreground cursor-pointer">Migration Hub</button>
            <ChevronRight className="h-3 w-3" />
            <span className="text-foreground font-medium">{project?.name ?? '…'}</span>
            <span className="text-muted-foreground">· Setup</span>
          </div>
          <h1 className="text-3xl font-bold tracking-tight">New Migration Setup</h1>
          <p className="text-muted-foreground mt-1">Complete each step to configure your migration before running analysis.</p>
        </div>

        {/* Stepper */}
        <SetupStepper
          currentStep={currentStep}
          completedSteps={completedSteps}
          onStepClick={handleStepClick}
        />

        {/* Step content */}
        {project && (
          <>
            {currentStep === 1 && (
              <Step1Details
                project={project}
                projectId={projectId}
                onNext={() => advanceTo(2)}
              />
            )}
            {currentStep === 2 && (
              <Step2Requirements
                projectId={projectId}
                onNext={() => advanceTo(3)}
              />
            )}
            {currentStep === 3 && (
              <Step3ReferenceData
                projectId={projectId}
                onNext={() => advanceTo(4)}
                onSkip={() => {
                  setupMutation.mutate({ id: projectId, referenceDataSkipped: true });
                  advanceTo(4);
                }}
              />
            )}
            {currentStep === 4 && (
              <Step4SourceData
                projectId={projectId}
                onNext={() => advanceTo(5)}
              />
            )}
            {currentStep === 5 && (
              <Step5FieldMapping
                projectId={projectId}
                onNext={() => advanceTo(6)}
              />
            )}
            {currentStep === 6 && (
              <Step6ReadyToAnalyze
                projectId={projectId}
                project={project}
                onAnalyze={handleAnalyzeComplete}
              />
            )}
          </>
        )}
      </main>
    </div>
  );
}
