import { XCircle } from 'lucide-react';
import { Button } from '../ui/Button';

interface RejectedScreenProps {
  onLogout: () => void;
}

function RejectedScreen({ onLogout }: RejectedScreenProps) {
  return (
    <div className="min-h-screen bg-[hsl(var(--background))] flex items-center justify-center px-4">
      <div className="max-w-md text-center">
        <div className="bg-[hsl(var(--card))] rounded-lg shadow p-8">
          <XCircle className="h-12 w-12 text-[hsl(var(--destructive))] mx-auto mb-4" />
          <h2 className="text-xl font-bold text-[hsl(var(--foreground))] mb-2">
            Application Not Approved
          </h2>
          <p className="text-[hsl(var(--muted-foreground))] mb-4">
            Unfortunately, your affiliate application was not approved.
            If you believe this is an error, please contact support.
          </p>
          <div className="mt-6">
            <Button variant="ghost" onClick={onLogout}>
              Sign Out
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}

export { RejectedScreen };
