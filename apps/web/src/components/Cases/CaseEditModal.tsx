import { useState } from 'react';
import { X } from 'lucide-react';
import { CaseStatus } from '../../types';
import type { NewCaseData } from './CaseCreateModal';

interface CaseEditModalProps {
  initialData: NewCaseData & { id: string };
  onClose: () => void;
  onSave: (id: string, caseData: NewCaseData) => Promise<void>;
}

export default function CaseEditModal({ initialData, onClose, onSave }: CaseEditModalProps) {
  const [form, setForm] = useState<NewCaseData>({
    diary_no: initialData.diary_no,
    diary_year: initialData.diary_year,
    case_number: initialData.case_number,
    parties: initialData.parties,
    petitioner: initialData.petitioner,
    respondent: initialData.respondent,
    status: initialData.status,
    court_no: initialData.court_no,
    judge: initialData.judge,
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const set = (field: keyof NewCaseData, value: string) =>
    setForm(f => ({ ...f, [field]: value }));

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.diary_no.trim()) {
      setError('Diary number is required.');
      return;
    }
    setSaving(true);
    setError('');
    try {
      await onSave(initialData.id, form);
      onClose();
    } catch (err: any) {
      setError(err.message || 'Failed to update case.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
      <div className="bg-white rounded-xl shadow-2xl w-full max-w-lg mx-4">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b">
          <h2 className="text-lg font-semibold text-gray-900">Edit Case</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600">
            <X size={20} />
          </button>
        </div>

        {/* Form */}
        <form onSubmit={handleSubmit} className="px-6 py-5 space-y-4">
          {error && (
            <div className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">
              {error}
            </div>
          )}

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-medium text-gray-700 mb-1">
                Diary Number <span className="text-red-500">*</span>
              </label>
              <input
                type="text"
                value={form.diary_no}
                onChange={e => set('diary_no', e.target.value)}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-700 mb-1">
                Diary Year <span className="text-red-500">*</span>
              </label>
              <input
                type="text"
                value={form.diary_year}
                onChange={e => set('diary_year', e.target.value)}
                maxLength={4}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>
          </div>

          <div>
            <label className="block text-xs font-medium text-gray-700 mb-1">Case Number</label>
            <input
              type="text"
              value={form.case_number}
              onChange={e => set('case_number', e.target.value)}
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>

          <div>
            <label className="block text-xs font-medium text-gray-700 mb-1">Parties</label>
            <input
              type="text"
              value={form.parties}
              onChange={e => set('parties', e.target.value)}
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-medium text-gray-700 mb-1">Petitioner</label>
              <input
                type="text"
                value={form.petitioner}
                onChange={e => set('petitioner', e.target.value)}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-700 mb-1">Respondent</label>
              <input
                type="text"
                value={form.respondent}
                onChange={e => set('respondent', e.target.value)}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-medium text-gray-700 mb-1">Status</label>
              <select
                value={form.status}
                onChange={e => set('status', e.target.value as CaseStatus)}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              >
                {Object.values(CaseStatus).map(s => (
                  <option key={s} value={s}>{s}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-700 mb-1">Court No.</label>
              <input
                type="text"
                value={form.court_no}
                onChange={e => set('court_no', e.target.value)}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>
          </div>

          <div>
            <label className="block text-xs font-medium text-gray-700 mb-1">Judge</label>
            <input
              type="text"
              value={form.judge}
              onChange={e => set('judge', e.target.value)}
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>

          {/* Footer */}
          <div className="flex justify-end gap-3 pt-2">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 text-sm text-gray-600 hover:text-gray-800"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={saving}
              className="px-5 py-2 text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 rounded-lg disabled:opacity-50"
            >
              {saving ? 'Saving...' : 'Save Changes'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
