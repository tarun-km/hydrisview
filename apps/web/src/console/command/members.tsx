'use client';

import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { patch, post } from '@/lib/api';
import { invalidatePaths, useAction } from '@/lib/query';
import { useSession } from '@/lib/session';
import { Button, Input } from '@/ui';
import { ConfirmDialog, Dialog } from '@/ui/overlay';
import { SiteAccessPicker, type Site } from '@/console/admin/parts';

export type MemberAction = 'suspend' | 'reactivate' | 'remove' | 'reset' | 'sessions';

export interface ActionTarget { userId: string; name: string; status: string; devices?: number }

const REFRESH = ['/members', '/command', '/devices', '/overview'];

/**
 * Confirmation dialogs for every consequential member action. Suspend and remove ask for a
 * reason, which is stored in the audit log with the action.
 */
export function MemberActionDialogs({ target, action, onDone }: { target: ActionTarget | null; action: MemberAction | null; onDone: () => void }) {
  const qc = useQueryClient();
  const first = target?.name.split(' ')[0] ?? '';
  const close = (v: boolean) => { if (!v) onDone(); };
  const run = async (path: string, body: unknown = {}) => {
    await post(path, body);
    invalidatePaths(qc, REFRESH);
  };
  if (!target) return null;
  return (
    <>
      <ConfirmDialog open={action === 'suspend'} onOpenChange={close} destructive title={`Suspend ${target.name}?`} noteLabel="Reason"
        body={<>Takes effect within seconds: every session for {first} ends (web, Hydris Field app){target.devices ? `, their ${target.devices} assigned glasses are unassigned and signed out` : ''}, and they cannot sign in. Records are kept; you can reactivate them later.</>}
        confirmLabel="Suspend" onConfirm={(reason) => run(`/members/${target.userId}/suspend`, { reason: reason || undefined })} />
      <ConfirmDialog open={action === 'remove'} onOpenChange={close} destructive title={`Remove ${target.name}?`} noteLabel="Reason"
        body={<>{first} loses access to this organization immediately and is signed out everywhere, including glasses. Their work history stays in the audit trail. To bring them back you must invite them again.</>}
        confirmLabel="Remove from organization" onConfirm={(reason) => run(`/members/${target.userId}/remove`, { reason: reason || undefined })} />
      <ConfirmDialog open={action === 'reactivate'} onOpenChange={close} title={`Reactivate ${target.name}?`} noteLabel="Note"
        body={<>They can sign in again with their existing password and keep their account type and site access. Glasses are not reassigned automatically.</>}
        confirmLabel="Reactivate" onConfirm={(reason) => run(`/members/${target.userId}/reactivate`, { reason: reason || undefined })} />
      <ConfirmDialog open={action === 'reset'} onOpenChange={close} title={`Reset access for ${target.name}?`}
        body={<>We email {first} a single-use link to choose a new password. Their current password keeps working until they use the link.</>}
        confirmLabel="Send reset link" onConfirm={() => run(`/command/operators/${target.userId}/reset-access`)} />
      <ConfirmDialog open={action === 'sessions'} onOpenChange={close} destructive title={`Sign ${target.name} out everywhere?`}
        body={<>Every web and Hydris Field app session for {first} ends now; they must sign in again. Paired glasses stay paired.</>}
        confirmLabel="Revoke all sessions" onConfirm={() => run(`/command/operators/${target.userId}/sessions/revoke`)} />
    </>
  );
}

export interface ProfileInput {
  userId: string; name: string; title: string | null; employeeId: string | null; phone: string | null; shiftLabel: string | null; allSites: boolean; siteIds: string[];
}

/** Edit an operator's profile, shift and site assignment (PATCH /members/:userId). */
export function EditProfileDialog({ member, sites, shifts, onClose }: { member: ProfileInput; sites: Site[]; shifts: string[]; onClose: () => void }) {
  const s = useSession();
  const [title, setTitle] = useState(member.title ?? '');
  const [employeeId, setEmployeeId] = useState(member.employeeId ?? '');
  const [phone, setPhone] = useState(member.phone ?? '');
  const [shift, setShift] = useState(member.shiftLabel ?? '');
  const [access, setAccess] = useState({ allSites: member.allSites, siteIds: member.siteIds });
  const act = useAction((v: Record<string, unknown>) => patch(`/members/${member.userId}`, v), { invalidate: REFRESH, success: 'Profile saved', onSuccess: onClose });
  const sitesInvalid = !access.allSites && !access.siteIds.length;
  const save = () => {
    if (sitesInvalid) return;
    const body: Record<string, unknown> = {
      title: title.trim() || null, employeeId: employeeId.trim() || null, phone: phone.trim() || null, shiftLabel: shift.trim() || null,
    };
    const accessDirty = access.allSites !== member.allSites || (!access.allSites && (access.siteIds.length !== member.siteIds.length || access.siteIds.some((x) => !member.siteIds.includes(x))));
    if (accessDirty) Object.assign(body, { allSites: access.allSites, siteIds: access.allSites ? [] : access.siteIds });
    act.mutate(body);
  };
  const listId = `shifts-${member.userId}`;
  return (
    <Dialog open onOpenChange={(v) => !v && onClose()} title={`Edit ${member.name}`} wide description="Profile, shift and the sites this person works at. Changes apply on their next request."
      footer={<>
        <Button variant="ghost" onClick={onClose}>Cancel</Button>
        <Button variant="primary" busy={act.isPending} disabled={sitesInvalid} onClick={save}>Save profile</Button>
      </>}>
      <form className="grid grid-cols-[minmax(0,1fr)] gap-5" onSubmit={(e) => { e.preventDefault(); save(); }}>
        <div className="grid grid-cols-[minmax(0,1fr)] gap-4 sm:grid-cols-2">
          <Input label="Job title" value={title} onChange={(e) => setTitle(e.target.value)} maxLength={80} placeholder="e.g. Field Operator" />
          <Input label="Employee ID" value={employeeId} onChange={(e) => setEmployeeId(e.target.value)} maxLength={40} />
          <Input label="Phone" type="tel" value={phone} onChange={(e) => setPhone(e.target.value)} maxLength={30} />
          <Input label="Shift" value={shift} onChange={(e) => setShift(e.target.value)} maxLength={60} list={listId} placeholder="A shift (06:00-14:00)" hint="Operators on the same shift form a team you can assign work to." />
          <datalist id={listId}>{shifts.map((x) => <option key={x} value={x} />)}</datalist>
        </div>
        <SiteAccessPicker sites={sites} allSites={access.allSites} siteIds={access.siteIds} onChange={setAccess} allowAllSites={s.siteScope === 'all'} />
      </form>
    </Dialog>
  );
}
