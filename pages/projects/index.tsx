import { usePageTitle, useNavigate, useServerMutation, currentUser } from '@aha-app/builder-core';
import { useGetProjects, createProject, deleteProject } from '@/server';
import AppHeader from '@/components/AppHeader';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
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
  Plus,
  Layers,
  ArrowRight,
  Trash2,
  Calendar,
  Database,
  Zap,
  CheckCircle2,
  Clock,
  Settings,
} from 'lucide-react';
import { useState } from 'react';
import { toast } from 'sonner';
import type { MigrationProject } from '@/db/schema';

const STATUS_COLORS: Record<string, string> = {
  setup: 'bg-muted text-muted-foreground border-border',
  analyzing: 'bg-blue-50 text-blue-700 border-blue-200',
  reviewing: 'bg-yellow-50 text-yellow-700 border-yellow-200',
  complete: 'bg-green-50 text-green-700 border-green-200',
};

const STATUS_LABELS: Record<string, string> = {
  setup: 'Setup',
  analyzing: 'Analyzing',
  reviewing: 'Reviewing',
  complete: 'Complete',
};

export default function MigrationHub() {
  usePageTitle('Migration Hub | MergeFlow');
  const navigate = useNavigate();
  const user = currentUser();
  const projectsQuery = useGetProjects();
  const { data: projects = [] } = projectsQuery;

  const [showCreate, setShowCreate] = useState(false);
  const [deleteId, setDeleteId] = useState<number | null>(null);
  const [form, setForm] = useState({ name: '', sourceOrg: '', destinationOrg: '', description: '' });

  const createMutation = useServerMutation(createProject, {
    query: projectsQuery,
    onSuccess: (project) => {
      setShowCreate(false);
      setForm({ name: '', sourceOrg: '', destinationOrg: '', description: '' });
      toast.success('Migration created — starting setup');
      navigate(`/projects/${project.id}/setup`);
    },
    onError: () => toast.error('Failed to create migration'),
  });

  const deleteMutation = useServerMutation(deleteProject, {
    query: projectsQuery,
    optimistic: (prev, input) => prev?.filter(p => p.id !== input.id),
    onSuccess: () => toast.success('Migration deleted'),
    onError: () => toast.error('Failed to delete migration'),
  });

  const handleCreate = () => {
    if (!form.name.trim() || !form.sourceOrg.trim() || !form.destinationOrg.trim()) {
      toast.error('Please fill in all required fields');
      return;
    }
    createMutation.mutate(form);
  };

  const inProgressProjects = projects.filter(p => p.status !== 'complete');
  const completedProjects = projects.filter(p => p.status === 'complete');

  const getProjectPath = (project: MigrationProject) => {
    if (!project.setupComplete) return `/projects/${project.id}/setup`;
    return `/projects/${project.id}`;
  };

  return (
    <div className="min-h-screen bg-background">
      <AppHeader />
      <main className="max-w-6xl mx-auto px-6 py-8">

        {/* Hero header */}
        <div className="flex items-start justify-between mb-8">
          <div>
            <h1 className="text-3xl font-bold tracking-tight">Migration Hub</h1>
            <p className="text-muted-foreground mt-1">
              {projects.length === 0
                ? 'Create your first migration to get started'
                : `${inProgressProjects.length} active migration${inProgressProjects.length !== 1 ? 's' : ''}${completedProjects.length > 0 ? `, ${completedProjects.length} complete` : ''}`}
            </p>
          </div>
          <Button onClick={() => setShowCreate(true)} size="lg">
            <Plus className="h-4 w-4" />
            New Migration
          </Button>
        </div>

        {projects.length === 0 ? (
          /* Empty state */
          <div className="border-2 border-dashed border-border rounded-xl p-16 text-center">
            <div className="h-16 w-16 rounded-2xl bg-primary/10 flex items-center justify-center mx-auto mb-6">
              <Layers className="h-8 w-8 text-primary" />
            </div>
            <h3 className="text-xl font-semibold mb-2">No migrations yet</h3>
            <p className="text-muted-foreground mb-6 max-w-md mx-auto">
              Create a migration to start moving data from one system to another. MergeFlow guides you through setup step by step.
            </p>
            <Button onClick={() => setShowCreate(true)} size="lg">
              <Plus className="h-4 w-4" />
              Create First Migration
            </Button>
          </div>
        ) : (
          <div className="space-y-8">
            {/* Active migrations */}
            {inProgressProjects.length > 0 && (
              <section>
                <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider mb-4">Active Migrations</h2>
                <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
                  {inProgressProjects.map(project => (
                    <MigrationCard
                      key={project.id}
                      project={project}
                      onClick={() => navigate(getProjectPath(project))}
                      onDelete={() => setDeleteId(project.id)}
                    />
                  ))}
                </div>
              </section>
            )}

            {/* Completed migrations */}
            {completedProjects.length > 0 && (
              <section>
                <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider mb-4">Completed Migrations</h2>
                <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
                  {completedProjects.map(project => (
                    <MigrationCard
                      key={project.id}
                      project={project}
                      onClick={() => navigate(getProjectPath(project))}
                      onDelete={() => setDeleteId(project.id)}
                    />
                  ))}
                </div>
              </section>
            )}
          </div>
        )}
      </main>

      {/* Create Dialog */}
      <Dialog open={showCreate} onOpenChange={setShowCreate}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>New Migration</DialogTitle>
            <DialogDescription>
              Start a guided setup to configure your migration. You'll define requirements, upload data, and map fields step by step.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label>Migration Name <span className="text-destructive">*</span></Label>
              <Input
                placeholder="e.g., North America CRM Migration Q1 2027"
                value={form.name}
                onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
                onKeyDown={e => e.key === 'Enter' && handleCreate()}
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
              </div>
              <div className="space-y-2">
                <Label>Destination Organization <span className="text-destructive">*</span></Label>
                <Input
                  placeholder="e.g., Salesforce"
                  value={form.destinationOrg}
                  onChange={e => setForm(f => ({ ...f, destinationOrg: e.target.value }))}
                />
              </div>
            </div>
            <div className="space-y-2">
              <Label>Description <span className="text-xs text-muted-foreground font-normal">(optional)</span></Label>
              <Textarea
                placeholder="Describe the scope and goals of this migration"
                value={form.description}
                onChange={e => setForm(f => ({ ...f, description: e.target.value }))}
                rows={2}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowCreate(false)}>Cancel</Button>
            <Button onClick={handleCreate} disabled={createMutation.isPending}>
              {createMutation.isPending ? 'Creating…' : 'Create & Start Setup'}
              <ArrowRight className="h-4 w-4" />
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete Confirm */}
      <AlertDialog open={deleteId !== null} onOpenChange={() => setDeleteId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Migration?</AlertDialogTitle>
            <AlertDialogDescription>
              This will permanently delete the migration and all its data including records, requirements, and audit history. This cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={() => { if (deleteId) deleteMutation.mutate({ id: deleteId }); setDeleteId(null); }}
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

function MigrationCard({
  project,
  onClick,
  onDelete,
}: {
  project: MigrationProject;
  onClick: () => void;
  onDelete: () => void;
}) {
  const isSetup = !project.setupComplete;
  return (
    <Card
      className="hover:shadow-md transition-shadow cursor-pointer group relative overflow-hidden"
      onClick={onClick}
    >
      {/* Setup-in-progress indicator */}
      {isSetup && (
        <div className="absolute top-0 left-0 right-0 h-0.5 bg-gradient-to-r from-primary to-secondary" />
      )}
      <CardHeader className="pb-3">
        <div className="flex items-start justify-between">
          <Badge
            variant="outline"
            className={`text-[10px] font-bold uppercase ${STATUS_COLORS[project.status]}`}
          >
            {isSetup ? 'Setting Up' : STATUS_LABELS[project.status]}
          </Badge>
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7 opacity-0 group-hover:opacity-100 text-muted-foreground hover:text-destructive"
            onClick={(e) => { e.stopPropagation(); onDelete(); }}
          >
            <Trash2 className="h-3.5 w-3.5" />
          </Button>
        </div>
        <CardTitle className="text-lg mt-2 leading-tight">{project.name}</CardTitle>
        {project.description && (
          <CardDescription className="line-clamp-2 text-xs">{project.description}</CardDescription>
        )}
      </CardHeader>
      <CardContent>
        <div className="space-y-2 text-xs text-muted-foreground mb-4">
          <div className="flex items-center gap-2">
            <Database className="h-3.5 w-3.5 shrink-0" />
            <span className="font-medium text-foreground truncate">{project.sourceOrg}</span>
            <ArrowRight className="h-3 w-3 shrink-0" />
            <span className="font-medium text-foreground truncate">{project.destinationOrg}</span>
          </div>
          <div className="flex items-center gap-2">
            <Calendar className="h-3.5 w-3.5" />
            <span>{new Date(project.createdAt!).toLocaleDateString()}</span>
          </div>
        </div>
        <Button
          className="w-full"
          variant={isSetup ? 'default' : 'outline'}
          onClick={onClick}
        >
          {isSetup ? (
            <>
              <Settings className="h-4 w-4" />
              Continue Setup
            </>
          ) : (
            <>
              Open Migration
              <ArrowRight className="h-4 w-4" />
            </>
          )}
        </Button>
      </CardContent>
    </Card>
  );
}
