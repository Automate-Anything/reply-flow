import WhatsAppConnection from '@/components/settings/WhatsAppConnection';
import AISettingsPanel from '@/components/settings/AISettingsPanel';

export default function SettingsPage() {
  return (
    <div className="mx-auto max-w-2xl space-y-6 p-6">
      <div>
        <h1 className="text-2xl font-semibold">Settings</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Manage your WhatsApp connection and preferences
        </p>
      </div>
      <WhatsAppConnection />
      <AISettingsPanel />
    </div>
  );
}
