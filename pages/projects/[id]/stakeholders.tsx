import { usePageTitle, useParams, useServerMutation, captureError } from '@aha-app/builder-core';
import {
  useGetProject,
  useGetStakeholders,
  createStakeholder,
  updateStakeholder,
  deleteStakeholder,
} from '@/server';
import AppHeader from '@/components/AppHeader';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogDescription,
} from '@/components/ui/dialog';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Users,
  Plus,
  Pencil,
  Trash2,
  Mail,
  Building2,
  UserCheck,
  Loader2,
  AlertCircle,
} from 'lucide-react';
import { useState } from 'react';
import { toast } from 'sonner';
import type { MigrationStakeholder } from '@/db/schema';

export const STAKEHOLDER_ROLES = [
  'Project Manager',
  'Legal',
  'Accounting',
  'Product',
  'HR',
  'Data',
  'Technical',
  'Executive',
  'Other',
] as const;

export const STAKEHOLDER_ORGS = [
  { value: 'source', label: 'Source Organization' },
  { value: 'destination', label: 'Destination Organization' },
] as const;

interface StakeholderFormData {
  name: string;
  email: string;
  organization: string;
  role: string;
  isAppUser: boolean;
  notes: string;
}

const emptyForm = (): StakeholderFormData => ({
  name: '',
  email: '',
  organization: 'source',
  role: 'Other',
  isAppUser: false,
  notes: '',
});

interface StakeholderDialogProps {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  projectId: number;
  editing?: MigrationStakeholder | null;
  onDone: () => void;
}

function StakeholderDialog({ open, onOpenChange, projectId, editing, onDone }: StakeholderDialogProps) {
  const [form, setForm] = useState<StakeholderFormData>(emptyForm());

  const set = (field: keyof StakeholderFormData, value: string | boolean) =>
    setForm(prev => ({ ...prev, [field]: value }));

  const createMutation = useServerMutation(createStakeholder, {
    onSuccess: () => {
      toast.success('Stakeholder added');
      onDone();
      onOpenChange(false);
    },
    onError: () => toast.error('Failed to add stakeholder'),
  });

  const updateMutation = useServerMutation(updateStakeholder, {
    onSuccess: () => {
      toast.success('Stakeholder updated');
      onDone();
      onOpenChange(false);
    },
    onError: () => toast.error('Failed to update stakeholder'),
  });

  const handleOpen = (v: boolean) => {
    if (v) {
      setForm(editing ? {
        name: editing.name,
        email: editing.email,
        organization: editing.organization,
        role: editing.role,
        isAppUser: editing.isAppUser,
        notes: editing.notes ?? '',
      } : emptyForm());
    }
    onOpenChange(v);
  };

  const isPending = createMutation.isPending || updateMutation.isPending;
  const isValid = form.name.trim() && form.email.trim();

  const handleSubmit = () => {
    if (!isValid) return;
    if (editing) {
      updateMutation.mutate({ id: editing.id, projectId, ...form, notes: form.notes || undefined });
    } else {
      createMutation.mutate({ projectId, ...form, notes: form.notes || undefined });
    }
  };

  return (
    <Dialog open={open} onOpenChange={handleOpen}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Users className="h-5 w-5 text-primary" />
            {editing ? 'Edit Stakeholder' : 'Add Stakeholder'}
          </DialogTitle>
          <DialogDescription>
            Stakeholders are the contacts responsible for answering clarification questions during this migration.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4 py-2">
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5 col-span-2">
              <Label className="text-xs font-semibold">Name <span className="text-destructive">*</span></Label>
              <Input
                placeholder="Full name"
                value={form.name}
                onChange={e => set('name', e.target.value)}
              />
            </div>
            <div className="space-y-1.5 col-span-2">
              <Label className="text-xs font-semibold">Email <span className="text-destructive">*</span></Label>
              <Input
                type="email"
                placeholder="email@company.com"
                value={form.email}
                onChange={e => set('email', e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs font-semibold">Organization</Label>
              <Select value={form.organization} onValueChange={v => set('organization', v)}>
                <SelectTrigger className="h-9 text-xs">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {STAKEHOLDER_ORGS.map(o => (
                    <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs font-semibold">Role / Domain</Label>
              <Select value={form.role} onValueChange={v => set('role', v)}>
                <SelectTrigger className="h-9 text-xs">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {STAKEHOLDER_ROLES.map(r => (
                    <SelectItem key={r} value={r}>{r}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="space-y-1.5">
            <Label className="text-xs font-semibold">Notes <span className="text-muted-foreground font-normal">(optional)</span></Label>
            <Textarea
              placeholder="Team, context, availability, or other notes"
              value={form.notes}
              onChange={e => set('notes', e.target.value)}
              rows={2}
            />
          </div>

          <div className="flex items-center gap-2">
            <input
              type="checkbox"
              id="isAppUser"
              checked={form.isAppUser}
              onChange={e => set('isAppUser', e.target.checked)}
              className="w-4 h-4 rounded border-border cursor-pointer"
            />
            <Label htmlFor="isAppUser" className="text-xs cursor-pointer">
              This person is an application user and can log in to MergeFlow
            </Label>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={handleSubmit} disabled={isPending || !isValid}>
            {isPending
              ? <><Loader2 className="h-4 w-4 animate-spin" /> Saving…</>
              : editing ? 'Update Stakeholder' : 'Add Stakeholder'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export default function StakeholdersPage() {
  const { id } = useParams();
  const projectId = Number(id);

  usePageTitle('Stakeholders | MergeFlow');

  const projectQuery = useGetProject({ id: projectId });
  const project = projectQuery.data;

  const stakeholdersQuery = useGetStakeholders({ projectId });
  const stakeholders = stakeholdersQuery.data ?? [];

  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<MigrationStakeholder | null>(null);
  const [deleteConfirmId, setDeleteConfirmId] = useState<number | null>(null);

  const deleteMutation = useServerMutation(deleteStakeholder, {
    query: stakeholdersQuery,
    optimistic: (prev, input) => prev?.filter(s => s.id !== input.id),
    onSuccess: () => toast.success('Stakeholder removed'),
    onError: () => toast.error('Failed to remove stakeholder'),
  });

  const grouped = {
    source: stakeholders.filter(s => s.organization === 'source'),
    destination: stakeholders.filter(s => s.organization === 'destination'),
  };

  return (
    <div className="min-h-screen bg-background">
      <AppHeader projectId={projectId} projectName={project?.name} />
      <main className="max-w-4xl mx-auto px-6 py-8">
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-2xl font-bold flex items-center gap-2">
              <Users className="h-6 w-6 text-primary" />
              Migration Stakeholders
            </h1>
            <p className="text-sm text-muted-foreground mt-1">
              Contacts responsible for answering clarification questions during this migration
            </p>
          </div>
          <Button onClick={() => { setEditing(null); setDialogOpen(true); }}>
            <Plus className="h-4 w-4" />
            Add Stakeholder
          </Button>
        </div>

        {stakeholders.length === 0 ? (
          <div className="border-2 border-dashed border-border rounded-xl p-12 text-center">
            <Users className="h-10 w-10 text-muted-foreground/30 mx-auto mb-3" />
            <p className="text-sm font-medium text-muted-foreground">No stakeholders yet</p>
            <p className="text-xs text-muted-foreground mt-1 mb-4">
              Add stakeholders to assign them to discussions and receive email notifications when clarifications are needed.
            </p>
            <Button onClick={() => { setEditing(null); setDialogOpen(true); }}>
              <Plus className="h-4 w-4" />
              Add First Stakeholder
            </Button>
          </div>
        ) : (
          <div className="space-y-6">
            {(['source', 'destination'] as const).map(org => {
              const list = grouped[org];
              if (list.length === 0) return null;
              return (
                <div key={org}>
                  <div className="flex items-center gap-2 mb-3">
                    <Building2 className="h-4 w-4 text-muted-foreground" />
                    <h2 className="text-sm font-bold uppercase tracking-widest text-muted-foreground">
                      {org === 'source' ? 'Source Organization' : 'Destination Organization'}
                    </h2>
                    <span className="text-xs bg-muted text-muted-foreground rounded-full px-2 py-0.5">{list.length}</span>
                  </div>
                  <div className="grid gap-3 sm:grid-cols-2">
                    {list.map(s => (
                      <div
                        key={s.id}
                        className="bg-card border border-border rounded-lg p-4 flex flex-col gap-2"
                      >
                        <div className="flex items-start justify-between gap-2">
                          <div className="flex items-center gap-2 min-w-0">
                            <div className="h-9 w-9 rounded-full bg-primary/10 flex items-center justify-center shrink-0 text-sm font-bold text-primary">
                              {s.name.slice(0, 1).toUpperCase()}
                            </div>
                            <div className="min-w-0">
                              <p className="text-sm font-semibold truncate">{s.name}</p>
                              <div className="flex items-center gap-1 text-xs text-muted-foreground">
                                <Mail className="h-3 w-3 shrink-0" />
                                <span className="truncate">{s.email}</span>
                              </div>
                            </div>
                          </div>
                          <div className="flex items-center gap-1 shrink-0">
                            <Button
                              variant="ghost"
                              size="sm"
                              className="h-7 w-7 p-0 cursor-pointer"
                              onClick={() => { setEditing(s); setDialogOpen(true); }}
                            >
                              <Pencil className="h-3.5 w-3.5" />
                            </Button>
                            <Button
                              variant="ghost"
                              size="sm"
                              className="h-7 w-7 p-0 text-destructive hover:bg-destructive/10 cursor-pointer"
                              onClick={() => setDeleteConfirmId(s.id)}
                            >
                              <Trash2 className="h-3.5 w-3.5" />
                            </Button>
                          </div>
                        </div>
                        <div className="flex items-center gap-2 flex-wrap">
                          <Badge variant="outline" className="text-[10px] px-2 py-0.5 bg-muted/60">
                            {s.role}
                          </Badge>
                          {s.isAppUser && (
                            <Badge variant="outline" className="text-[10px] px-2 py-0.5 bg-green-50 text-green-700 border-green-200">
                              <UserCheck className="h-3 w-3 mr-1" />
                              App User
                            </Badge>
                          )}
                        </div>
                        {s.notes && (
                          <p className="text-xs text-muted-foreground leading-snug">{s.notes}</p>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </main>

      <StakeholderDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        projectId={projectId}
        editing={editing}
        onDone={() => stakeholdersQuery.refetch?.()}
      />

      {/* Delete confirm dialog */}
      <Dialog open={deleteConfirmId !== null} onOpenChange={v => { if (!v) setDeleteConfirmId(null); }}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <AlertCircle className="h-5 w-5 text-destructive" />
              Remove Stakeholder
            </DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground py-2">
            This will remove the stakeholder from this migration. Existing discussions linked to them will not be affected.
          </p>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteConfirmId(null)}>Cancel</Button>
            <Button
              variant="destructive"
              onClick={() => {
                if (deleteConfirmId !== null) {
                  deleteMutation.mutate({ id: deleteConfirmId, projectId });
                  setDeleteConfirmId(null);
                }
              }}
              disabled={deleteMutation.isPending}
            >
              Remove
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
