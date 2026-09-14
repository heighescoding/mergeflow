import { usePageTitle, useParams, useServerMutation, useNavigate } from '@aha-app/builder-core';
import {
  useGetProject,
  useGetDestinationFields,
  useGetValidationRules,
  useGetSourceFiles,
  updateDestinationField,
  createValidationRule,
  updateValidationRule,
  deleteValidationRule,
} from '@/server';
import AppHeader from '@/components/AppHeader';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
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
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import {
  Plus,
  Trash2,
  Link2,
  Settings2,
  CheckCircle2,
  AlertCircle,
  ShieldCheck,
  ArrowRight,
  Info,
} from 'lucide-react';
import { useState } from 'react';
import { toast } from 'sonner';
import type { DestinationField, ValidationRule } from '@/db/schema';

const RULE_TYPES = ['required', 'unique', 'email_format', 'allowed_values', 'data_type', 'regex', 'min_length', 'max_length'] as const;

const FIELD_TYPE_LABELS: Record<string, string> = {
  text: 'Text',
  number: 'Number',
  email: 'Email',
  date: 'Date',
  boolean: 'Boolean',
  enum_type: 'Enum',
  currency: 'Currency',
  identifier: 'Identifier',
};

export default function SchemaPage() {
  const { id } = useParams();
  const projectId = Number(id);
  const navigate = useNavigate();
  usePageTitle('Field Mapping & Validation | MergeFlow');

  const projectQuery = useGetProject({ id: projectId });
  const fieldsQuery = useGetDestinationFields({ projectId });
  const rulesQuery = useGetValidationRules({ projectId });
  const filesQuery = useGetSourceFiles({ projectId });

  const project = projectQuery.data;
  const fields = fieldsQuery.data ?? [];
  const rules = rulesQuery.data ?? [];
  const files = filesQuery.data ?? [];
  const sourceColumns = [...new Set(files.flatMap(f => f.columns ?? []))];

  const [showRuleForm, setShowRuleForm] = useState(false);
  const [ruleForm, setRuleForm] = useState({ name: '', ruleType: 'required' as ValidationRule['ruleType'], fieldId: '' });
  const [deleteRuleId, setDeleteRuleId] = useState<number | null>(null);

  const updateMappingMutation = useServerMutation(updateDestinationField, {
    query: fieldsQuery,
    optimistic: (prev, input) => prev?.map(f => f.id === input.id ? { ...f, ...input, status: input.sourceMapping ? 'mapped' : 'missing' as DestinationField['status'] } : f),
    onError: () => toast.error('Failed to update mapping'),
    refetchOnSuccess: true,
  });

  const createRuleMutation = useServerMutation(createValidationRule, {
    query: rulesQuery,
    onSuccess: () => { setShowRuleForm(false); setRuleForm({ name: '', ruleType: 'required', fieldId: '' }); toast.success('Rule added'); },
    onError: () => toast.error('Failed to add rule'),
  });

  const updateRuleMutation = useServerMutation(updateValidationRule, {
    query: rulesQuery,
    optimistic: (prev, input) => prev?.map(r => r.id === input.id ? { ...r, ...input } : r),
    onError: () => toast.error('Failed to update rule'),
  });

  const deleteRuleMutation = useServerMutation(deleteValidationRule, {
    query: rulesQuery,
    optimistic: (prev, input) => prev?.filter(r => r.id !== input.id),
    onSuccess: () => toast.success('Rule deleted'),
    onError: () => toast.error('Failed to delete rule'),
  });

  const mappedCount = fields.filter(f => f.sourceMapping).length;

  return (
    <div className="min-h-screen bg-background">
      <AppHeader projectId={projectId} projectName={project?.name} />
      <main className="max-w-6xl mx-auto px-6 py-8 pb-16">
        <div className="flex items-start justify-between mb-6">
          <div>
            <h1 className="text-3xl font-bold tracking-tight">Field Mapping & Validation Rules</h1>
            <p className="text-muted-foreground mt-1">Map source columns to destination fields and configure advanced validation</p>
          </div>
        </div>

        {/* Redirect notice */}
        <div className="flex items-start gap-3 p-4 rounded-lg border border-blue-200 bg-blue-50 mb-6">
          <Info className="h-5 w-5 text-blue-600 shrink-0 mt-0.5" />
          <div className="flex-1 min-w-0">
            <p className="text-sm font-medium text-blue-900">
              Destination fields are managed in Destination Requirements
            </p>
            <p className="text-xs text-blue-700 mt-0.5">
              Add, remove, or confirm fields there. This page lets you map each confirmed field to a source column and configure extra validation rules.
            </p>
          </div>
          <Button
            size="sm"
            variant="outline"
            className="shrink-0 border-blue-400 text-blue-800 hover:bg-blue-100"
            onClick={() => navigate(`/projects/${projectId}/requirements`)}
          >
            <ShieldCheck className="h-4 w-4" />
            Go to Requirements
            <ArrowRight className="h-3.5 w-3.5" />
          </Button>
        </div>

        <div className="grid gap-6 lg:grid-cols-3">
          {/* Field Mapping Table */}
          <div className="lg:col-span-2">
            <Card>
              <CardHeader className="pb-3">
                <CardTitle>Source Column Mapping</CardTitle>
                <CardDescription>
                  {fields.length > 0
                    ? `${mappedCount} of ${fields.length} fields mapped to source columns`
                    : 'No destination fields defined yet. Add them in Destination Requirements.'}
                </CardDescription>
              </CardHeader>
              <CardContent className="p-0">
                {fields.length === 0 ? (
                  <div className="text-center py-10 text-sm text-muted-foreground px-6">
                    <ShieldCheck className="h-10 w-10 mx-auto mb-3 opacity-20" />
                    <p className="font-medium mb-1">No destination fields defined</p>
                    <p className="text-xs mb-4">Define fields in Destination Requirements first.</p>
                    <Button variant="outline" onClick={() => navigate(`/projects/${projectId}/requirements`)}>
                      <ShieldCheck className="h-4 w-4" />
                      Go to Requirements
                    </Button>
                  </div>
                ) : (
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Destination Field</TableHead>
                        <TableHead>Type</TableHead>
                        <TableHead>Required</TableHead>
                        <TableHead>Confirmed</TableHead>
                        <TableHead>Source Column</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {fields.map(field => (
                        <TableRow key={field.id} className="hover:bg-muted/30">
                          <TableCell className="font-medium text-sm">{field.fieldName}</TableCell>
                          <TableCell className="text-xs text-muted-foreground">
                            {FIELD_TYPE_LABELS[field.fieldType] ?? field.fieldType}
                          </TableCell>
                          <TableCell>
                            {field.required
                              ? <Badge variant="outline" className="text-[9px] px-1 bg-primary/10 text-primary border-primary/20">YES</Badge>
                              : <span className="text-[10px] text-muted-foreground">No</span>}
                          </TableCell>
                          <TableCell>
                            {field.isConfirmed
                              ? <Badge variant="outline" className="text-[9px] px-1.5 bg-green-50 text-green-700 border-green-200 gap-1"><CheckCircle2 className="h-2.5 w-2.5" />Yes</Badge>
                              : <Badge variant="outline" className="text-[9px] px-1.5 bg-yellow-50 text-yellow-700 border-yellow-200 gap-1"><AlertCircle className="h-2.5 w-2.5" />Unconfirmed</Badge>}
                          </TableCell>
                          <TableCell>
                            {sourceColumns.length > 0 ? (
                              <Select
                                value={field.sourceMapping ?? '__none__'}
                                onValueChange={v => updateMappingMutation.mutate({
                                  id: field.id,
                                  projectId,
                                  sourceMapping: v === '__none__' ? null : v,
                                })}
                              >
                                <SelectTrigger className="h-7 text-xs w-[160px]">
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
                              <span className="text-[11px] text-muted-foreground italic">Import CSV to map</span>
                            )}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                )}
              </CardContent>
            </Card>
          </div>

          {/* Sidebar */}
          <div className="space-y-4">
            {/* Validation Rules */}
            <Card>
              <CardHeader className="pb-3">
                <div className="flex items-center justify-between">
                  <CardTitle className="text-sm flex items-center gap-2">
                    <Settings2 className="h-4 w-4 text-secondary" />
                    Validation Rules
                  </CardTitle>
                  <Button variant="ghost" size="sm" className="h-7 text-xs" onClick={() => setShowRuleForm(true)}>
                    <Plus className="h-3.5 w-3.5" />
                  </Button>
                </div>
                <CardDescription className="text-[11px] mt-1">
                  Advanced rules run in addition to field-level requirements
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-2">
                {rules.length === 0 ? (
                  <p className="text-xs text-muted-foreground text-center py-3">No custom rules defined</p>
                ) : (
                  rules.map(rule => (
                    <div key={rule.id} className="flex items-center justify-between p-2 rounded border border-border bg-muted/20">
                      <div className="flex-1 min-w-0">
                        <p className="text-xs font-medium truncate">{rule.name}</p>
                        <p className="text-[10px] text-muted-foreground capitalize">{rule.ruleType.replace('_', ' ')}</p>
                      </div>
                      <div className="flex items-center gap-1.5 ml-2">
                        <Switch
                          checked={rule.enabled}
                          onCheckedChange={v => updateRuleMutation.mutate({ id: rule.id, projectId, enabled: v })}
                          className="scale-75"
                        />
                        <Button
                          variant="ghost" size="icon"
                          className="h-6 w-6 text-muted-foreground hover:text-destructive"
                          onClick={() => setDeleteRuleId(rule.id)}
                        >
                          <Trash2 className="h-3 w-3" />
                        </Button>
                      </div>
                    </div>
                  ))
                )}
                <Button
                  variant="outline"
                  size="sm"
                  className="w-full text-xs border-dashed mt-2"
                  onClick={() => setShowRuleForm(true)}
                >
                  <Plus className="h-3 w-3" /> Add Rule
                </Button>
              </CardContent>
            </Card>

            {/* Source Files Summary */}
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-sm">Source Files</CardTitle>
              </CardHeader>
              <CardContent>
                {files.length === 0 ? (
                  <p className="text-xs text-muted-foreground">No source files imported yet</p>
                ) : (
                  <div className="space-y-2">
                    {files.map(file => (
                      <div key={file.id} className="flex items-center gap-2">
                        <div className={`h-6 w-6 rounded flex items-center justify-center shrink-0 ${file.status === 'complete' ? 'bg-green-100' : 'bg-yellow-100'}`}>
                          {file.status === 'complete'
                            ? <CheckCircle2 className="h-3.5 w-3.5 text-green-700" />
                            : <AlertCircle className="h-3.5 w-3.5 text-yellow-700" />}
                        </div>
                        <div>
                          <p className="text-xs font-medium truncate max-w-[140px]">{file.fileName}</p>
                          <p className="text-[10px] text-muted-foreground">{file.rowCount.toLocaleString()} rows</p>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>
          </div>
        </div>
      </main>

      {/* Rule Dialog */}
      <Dialog open={showRuleForm} onOpenChange={setShowRuleForm}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Add Validation Rule</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label>Rule Name <span className="text-destructive">*</span></Label>
              <Input
                placeholder="e.g., Unique Tax ID"
                value={ruleForm.name}
                onChange={e => setRuleForm(f => ({ ...f, name: e.target.value }))}
              />
            </div>
            <div className="space-y-2">
              <Label>Rule Type</Label>
              <Select value={ruleForm.ruleType} onValueChange={v => setRuleForm(f => ({ ...f, ruleType: v as ValidationRule['ruleType'] }))}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {RULE_TYPES.map(t => (
                    <SelectItem key={t} value={t}>{t.replace(/_/g, ' ')}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            {fields.length > 0 && (
              <div className="space-y-2">
                <Label>Apply to Field <span className="text-xs text-muted-foreground font-normal">(optional)</span></Label>
                <Select value={ruleForm.fieldId || '__none__'} onValueChange={v => setRuleForm(f => ({ ...f, fieldId: v === '__none__' ? '' : v }))}>
                  <SelectTrigger><SelectValue placeholder="All fields" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__none__">All fields</SelectItem>
                    {fields.map(f => (
                      <SelectItem key={f.id} value={String(f.id)}>{f.fieldName}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowRuleForm(false)}>Cancel</Button>
            <Button
              onClick={() => {
                if (!ruleForm.name.trim()) { toast.error('Rule name required'); return; }
                createRuleMutation.mutate({
                  projectId,
                  name: ruleForm.name.trim(),
                  ruleType: ruleForm.ruleType,
                  fieldId: ruleForm.fieldId ? Number(ruleForm.fieldId) : undefined,
                });
              }}
              disabled={createRuleMutation.isPending}
            >
              Add Rule
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete Rule */}
      <AlertDialog open={deleteRuleId !== null} onOpenChange={() => setDeleteRuleId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Rule?</AlertDialogTitle>
            <AlertDialogDescription>This rule will no longer be applied during analysis.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground"
              onClick={() => { if (deleteRuleId) deleteRuleMutation.mutate({ id: deleteRuleId, projectId }); setDeleteRuleId(null); }}
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}