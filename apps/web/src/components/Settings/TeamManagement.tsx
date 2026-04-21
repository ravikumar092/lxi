import { useState, useEffect } from 'react';
import { UserPlus, Trash2, Mail, Shield, Users } from 'lucide-react';
import { TeamMemberRole } from '../../types';
import type { TeamMember, Team } from '../../types';
import {
  loadTeamMembers,
  inviteTeamMember,
  removeTeamMember,
  getOrCreateTeam,
  buildMemberEmail,
} from '../../services/teamService';
import { useUser } from '../../context/UserContext';

const ROLE_OPTIONS: TeamMemberRole[] = [
  TeamMemberRole.ASSOCIATE_ADVOCATE,
  TeamMemberRole.CLERK,
];

const ROLE_LABELS: Record<TeamMemberRole, string> = {
  [TeamMemberRole.ADMIN]: 'Admin (Lawyer)',
  [TeamMemberRole.ASSOCIATE_ADVOCATE]: 'Associate Advocate',
  [TeamMemberRole.CLERK]: 'Clerk',
};

const ROLE_COLORS: Record<TeamMemberRole, string> = {
  [TeamMemberRole.ADMIN]: 'bg-blue-100 text-blue-800',
  [TeamMemberRole.ASSOCIATE_ADVOCATE]: 'bg-green-100 text-green-800',
  [TeamMemberRole.CLERK]: 'bg-yellow-100 text-yellow-800',
};

export default function TeamManagement() {
  const { userProfile } = useUser();
  const [team, setTeam] = useState<Team | null>(null);
  const [members, setMembers] = useState<TeamMember[]>([]);
  const [loading, setLoading] = useState(true);
  const [teamName, setTeamName] = useState('');
  const [creatingTeam, setCreatingTeam] = useState(false);

  // Invite form
  const [showInvite, setShowInvite] = useState(false);
  const [inviteName, setInviteName] = useState('');
  const [inviteRole, setInviteRole] = useState<TeamMemberRole>(TeamMemberRole.ASSOCIATE_ADVOCATE);
  const [inviting, setInviting] = useState(false);
  const [inviteResult, setInviteResult] = useState<{ email: string } | null>(null);
  const [error, setError] = useState('');

  const isAdmin = userProfile?.role === TeamMemberRole.ADMIN;

  useEffect(() => {
    loadData();
  }, []);

  async function loadData() {
    setLoading(true);
    try {
      const [teamData, membersData] = await Promise.all([
        import('../../services/teamService').then(m => m.getMyTeam()),
        loadTeamMembers(),
      ]);
      setTeam(teamData);
      setMembers(membersData);
    } finally {
      setLoading(false);
    }
  }

  async function handleCreateTeam() {
    if (!teamName.trim()) return;
    setCreatingTeam(true);
    setError('');
    try {
      const t = await getOrCreateTeam(teamName.trim());
      setTeam(t);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setCreatingTeam(false);
    }
  }

  async function handleInvite() {
    if (!inviteName.trim()) { setError('Please enter a name.'); return; }
    if (members.length >= 3) { setError('Maximum 3 team members allowed.'); return; }
    setInviting(true);
    setError('');
    setInviteResult(null);
    try {
      const result = await inviteTeamMember(inviteName.trim(), inviteRole);
      if (result) {
        setInviteResult({ email: result.email });
        setMembers(prev => [...prev, result.member]);
        setInviteName('');
        setShowInvite(false);
      }
    } catch (e: any) {
      setError(e.message);
    } finally {
      setInviting(false);
    }
  }

  async function handleRemove(memberId: string) {
    if (!confirm('Remove this team member?')) return;
    try {
      await removeTeamMember(memberId);
      setMembers(prev => prev.filter(m => m.id !== memberId));
    } catch (e: any) {
      setError(e.message);
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center h-48 text-gray-400 text-sm">
        Loading team...
      </div>
    );
  }

  // No team yet → prompt admin to create one
  if (!team) {
    if (!isAdmin) {
      return (
        <div className="text-center text-gray-500 text-sm py-12">
          Your admin has not set up a team yet.
        </div>
      );
    }
    return (
      <div className="max-w-md mx-auto mt-12 p-6 bg-white rounded-xl border shadow-sm">
        <div className="flex items-center gap-2 mb-4">
          <Shield size={20} className="text-blue-600" />
          <h2 className="text-base font-semibold text-gray-900">Set Up Your Team</h2>
        </div>
        <p className="text-sm text-gray-500 mb-4">
          Give your team a name to get started. You can then invite up to 3 members.
        </p>
        <input
          type="text"
          value={teamName}
          onChange={e => setTeamName(e.target.value)}
          placeholder="e.g. Kumar & Associates"
          className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm mb-3 focus:outline-none focus:ring-2 focus:ring-blue-500"
        />
        {error && <p className="text-xs text-red-600 mb-2">{error}</p>}
        <button
          onClick={handleCreateTeam}
          disabled={creatingTeam || !teamName.trim()}
          className="w-full py-2 text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 rounded-lg disabled:opacity-50"
        >
          {creatingTeam ? 'Creating...' : 'Create Team'}
        </button>
      </div>
    );
  }

  return (
    <div className="max-w-2xl mx-auto space-y-6">
      {/* Team header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-base font-semibold text-gray-900 flex items-center gap-2">
            <Users size={18} className="text-blue-600" />
            {team.name}
          </h2>
          <p className="text-xs text-gray-500 mt-0.5">{members.length}/3 team members</p>
        </div>
        {isAdmin && members.length < 3 && (
          <button
            onClick={() => { setShowInvite(true); setError(''); setInviteResult(null); }}
            className="flex items-center gap-1.5 px-4 py-2 text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 rounded-lg"
          >
            <UserPlus size={15} />
            Invite Member
          </button>
        )}
      </div>

      {error && (
        <div className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">
          {error}
        </div>
      )}

      {inviteResult && (
        <div className="text-sm text-green-700 bg-green-50 border border-green-200 rounded-lg px-3 py-2">
          Invited! Login credentials: <strong>{inviteResult.email}</strong>
          <br />
          <span className="text-xs text-green-600">
            Share this email with your team member. They can set their own password via the invite link sent to this email.
          </span>
        </div>
      )}

      {/* Invite form */}
      {showInvite && (
        <div className="bg-gray-50 border border-gray-200 rounded-xl p-4 space-y-3">
          <h3 className="text-sm font-medium text-gray-800">New Team Member</h3>
          <div>
            <label className="block text-xs text-gray-600 mb-1">Full Name</label>
            <input
              type="text"
              value={inviteName}
              onChange={e => setInviteName(e.target.value)}
              placeholder="e.g. Priya Rajan"
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
            {inviteName.trim() && (
              <p className="text-xs text-gray-400 mt-1 flex items-center gap-1">
                <Mail size={11} />
                Login email: <strong>{buildMemberEmail(inviteName)}</strong>
              </p>
            )}
          </div>
          <div>
            <label className="block text-xs text-gray-600 mb-1">Role</label>
            <select
              value={inviteRole}
              onChange={e => setInviteRole(e.target.value as TeamMemberRole)}
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              {ROLE_OPTIONS.map(r => (
                <option key={r} value={r}>{ROLE_LABELS[r]}</option>
              ))}
            </select>
          </div>
          <div className="flex gap-2 pt-1">
            <button
              onClick={handleInvite}
              disabled={inviting || !inviteName.trim()}
              className="px-4 py-2 text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 rounded-lg disabled:opacity-50"
            >
              {inviting ? 'Inviting...' : 'Send Invite'}
            </button>
            <button
              onClick={() => setShowInvite(false)}
              className="px-4 py-2 text-sm text-gray-600 hover:text-gray-800"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {/* Admin row */}
      <div className="bg-white rounded-xl border divide-y">
        <div className="flex items-center justify-between px-4 py-3">
          <div>
            <p className="text-sm font-medium text-gray-900">{userProfile?.full_name || 'You'}</p>
            <p className="text-xs text-gray-400">{userProfile?.email}</p>
          </div>
          <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${ROLE_COLORS[TeamMemberRole.ADMIN]}`}>
            {ROLE_LABELS[TeamMemberRole.ADMIN]}
          </span>
        </div>

        {members.length === 0 && (
          <div className="px-4 py-6 text-center text-sm text-gray-400">
            No team members yet. Invite up to 3 members.
          </div>
        )}

        {members.map(member => (
          <div key={member.id} className="flex items-center justify-between px-4 py-3">
            <div>
              <p className="text-sm font-medium text-gray-900">{member.full_name}</p>
              <p className="text-xs text-gray-400 flex items-center gap-1">
                <Mail size={10} />
                {member.email}
              </p>
              <p className="text-xs text-gray-300 mt-0.5">
                {member.joined_at ? 'Active' : 'Invite pending'}
              </p>
            </div>
            <div className="flex items-center gap-3">
              <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${ROLE_COLORS[member.role]}`}>
                {ROLE_LABELS[member.role]}
              </span>
              {isAdmin && (
                <button
                  onClick={() => handleRemove(member.id)}
                  className="text-red-400 hover:text-red-600"
                  title="Remove member"
                >
                  <Trash2 size={14} />
                </button>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
