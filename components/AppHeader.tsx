import { Link, useLocation, useNavigate, currentUser, redirectToLogout } from '@aha-app/builder-core';
import { Layers, Bell, Settings, LogOut, ChevronDown, CheckCheck } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Badge } from '@/components/ui/badge';
import { useGetNotifications, markAllNotificationsRead, markNotificationRead } from '@/server';
import { useServerMutation } from '@aha-app/builder-core';
import { toast } from 'sonner';
import { useNavigate as useNav } from '@aha-app/builder-core';

interface AppHeaderProps {
  projectId?: number;
  projectName?: string;
}

export default function AppHeader({ projectId, projectName }: AppHeaderProps) {
  const user = currentUser();
  const location = useLocation();
  const navigate = useNav();

  const notificationsQuery = useGetNotifications({ limit: 20 });
  const notificationsData = notificationsQuery.data;
  const notifications = notificationsData?.notifications ?? [];
  const unreadCount = notificationsData?.unreadCount ?? 0;

  const markAllMutation = useServerMutation(markAllNotificationsRead, {
    query: notificationsQuery,
    optimistic: (prev) => prev ? { ...prev, notifications: prev.notifications.map(n => ({ ...n, isRead: true })), unreadCount: 0 } : prev,
    onError: () => toast.error('Failed to mark notifications as read'),
  });

  const markOneMutation = useServerMutation(markNotificationRead, {
    query: notificationsQuery,
    optimistic: (prev, input) => prev ? {
      ...prev,
      notifications: prev.notifications.map(n => n.id === input.notificationId ? { ...n, isRead: true } : n),
      unreadCount: Math.max(0, (prev.unreadCount ?? 0) - 1),
    } : prev,
    onError: () => toast.error('Failed to mark notification as read'),
  });

  const initials = user
    ? `${user.firstName?.[0] ?? ''}${user.lastName?.[0] ?? user.email[0]}`.toUpperCase()
    : '?';

  return (
    <header className="sticky top-0 z-50 w-full border-b bg-primary text-primary-foreground">
      <div className="px-6 flex h-14 items-center justify-between">
        {/* Logo + Nav */}
        <div className="flex items-center gap-6">
          <Link to="/projects" className="flex items-center gap-2 no-underline">
            <div className="h-8 w-8 rounded bg-secondary flex items-center justify-center">
              <Layers className="h-5 w-5 text-secondary-foreground" />
            </div>
            <span className="text-lg font-bold tracking-tight text-primary-foreground">MergeFlow</span>
          </Link>

          {projectId && (
            <nav className="hidden md:flex items-center gap-1">
              <div className="h-4 w-px bg-primary-foreground/20 mx-2" />
              <span className="text-xs text-primary-foreground/60 mr-1">
                {projectName ?? `Project #${projectId}`}
              </span>
              <div className="h-4 w-px bg-primary-foreground/20 mx-2" />
              <NavLink to={`/projects/${projectId}`} active={location === `/projects/${projectId}`}>
                Dashboard
              </NavLink>
              <NavLink to={`/projects/${projectId}/review`} active={location.startsWith(`/projects/${projectId}/review`)}>
                Review
              </NavLink>
              <NavLink to={`/projects/${projectId}/requirements`} active={location.startsWith(`/projects/${projectId}/requirements`)}>
                Requirements
              </NavLink>
              <NavLink to={`/projects/${projectId}/schema`} active={location.startsWith(`/projects/${projectId}/schema`)}>
                Schema & Rules
              </NavLink>
              <NavLink to={`/projects/${projectId}/stakeholders`} active={location.startsWith(`/projects/${projectId}/stakeholders`)}>
                Stakeholders
              </NavLink>
              <NavLink to={`/projects/${projectId}/audit`} active={location.startsWith(`/projects/${projectId}/audit`)}>
                Audit Log
              </NavLink>
            </nav>
          )}

          {!projectId && (
            <nav className="hidden md:flex items-center gap-1">
              <NavLink to="/projects" active={location.startsWith('/projects')}>
                Projects
              </NavLink>
            </nav>
          )}
        </div>

        {/* Right: Notifications + User */}
        <div className="flex items-center gap-2">
          {/* Notification Bell */}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="sm" className="relative text-primary-foreground hover:bg-primary-foreground/10 px-2">
                <Bell className="h-4.5 w-4.5" />
                {unreadCount > 0 && (
                  <span className="absolute -top-0.5 -right-0.5 h-4 min-w-[16px] rounded-full bg-secondary text-secondary-foreground text-[9px] font-bold flex items-center justify-center px-0.5">
                    {unreadCount > 9 ? '9+' : unreadCount}
                  </span>
                )}
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-80">
              <div className="flex items-center justify-between px-3 py-2 border-b">
                <p className="text-sm font-semibold">Notifications</p>
                {unreadCount > 0 && (
                  <Button
                    variant="ghost"
                    size="sm"
                    className="text-[10px] h-6 px-2 gap-1 text-muted-foreground hover:text-foreground cursor-pointer"
                    onClick={() => markAllMutation.mutate({})}
                  >
                    <CheckCheck className="h-3 w-3" /> Mark all read
                  </Button>
                )}
              </div>
              {notifications.length === 0 ? (
                <div className="px-3 py-6 text-center text-xs text-muted-foreground">
                  No notifications
                </div>
              ) : (
                <div className="max-h-72 overflow-y-auto">
                  {notifications.map(n => (
                    <button
                      key={n.id}
                      className={`w-full text-left px-3 py-2.5 border-b last:border-0 cursor-pointer transition-colors hover:bg-muted/50 ${!n.isRead ? 'bg-blue-50/50' : ''}`}
                      onClick={() => {
                        if (!n.isRead) markOneMutation.mutate({ notificationId: n.id });
                        if (n.projectId && n.recordId) {
                          navigate(`/projects/${n.projectId}/review`);
                        }
                      }}
                    >
                      <div className="flex items-start gap-2">
                        {!n.isRead && <div className="h-2 w-2 rounded-full bg-blue-500 shrink-0 mt-1" />}
                        {n.isRead && <div className="h-2 w-2 shrink-0 mt-1" />}
                        <div className="flex-1 min-w-0">
                          <p className="text-xs font-medium truncate">{n.title}</p>
                          <p className="text-[11px] text-muted-foreground line-clamp-2 mt-0.5">{n.message}</p>
                        </div>
                      </div>
                    </button>
                  ))}
                </div>
              )}
            </DropdownMenuContent>
          </DropdownMenu>

          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="sm" className="gap-2 text-primary-foreground hover:bg-primary-foreground/10">
                <div className="h-7 w-7 rounded-full bg-secondary text-secondary-foreground flex items-center justify-center text-xs font-bold">
                  {initials}
                </div>
                <span className="text-xs hidden md:block">
                  {user?.firstName ?? user?.email}
                </span>
                <ChevronDown className="h-3 w-3 opacity-60" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <div className="px-2 py-1.5">
                <p className="text-sm font-medium">{user?.firstName} {user?.lastName}</p>
                <p className="text-xs text-muted-foreground">{user?.email}</p>
              </div>
              <DropdownMenuSeparator />
              <DropdownMenuItem onClick={() => redirectToLogout()} className="cursor-pointer text-destructive">
                <LogOut className="h-4 w-4" />
                Sign out
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>
    </header>
  );
}

function NavLink({ to, active, children }: { to: string; active: boolean; children: React.ReactNode }) {
  return (
    <Link
      to={to}
      className={`text-sm px-3 py-1.5 rounded transition-colors no-underline font-medium ${
        active
          ? 'bg-secondary text-secondary-foreground'
          : 'text-primary-foreground/80 hover:bg-primary-foreground/10'
      }`}
    >
      {children}
    </Link>
  );
}
