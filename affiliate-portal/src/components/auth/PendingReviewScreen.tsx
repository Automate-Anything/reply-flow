import { Clock } from 'lucide-react';
import { Button } from '../ui/Button';

interface PendingReviewScreenProps {
  onLogout: () => void;
}

function PendingReviewScreen({ onLogout }: PendingReviewScreenProps) {
  return (
    <div className="min-h-screen bg-[hsl(var(--background))] flex items-center justify-center px-4">
      <div className="max-w-md text-center">
        <div className="bg-[hsl(var(--card))] rounded-lg shadow p-8">
          <Clock className="h-12 w-12 text-[hsl(var(--warning))] mx-auto mb-4" />
          <h2 className="text-xl font-bold text-[hsl(var(--foreground))] mb-2">
            Application Under Review
          </h2>
          <p className="text-[hsl(var(--muted-foreground))] mb-4">
            Thank you for signing up! Our team is reviewing your application.
            You'll receive an email once your account is approved.
          </p>
          <p className="text-sm text-[hsl(var(--muted-foreground))]">
            This usually takes 1-2 business days.
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

export { PendingReviewScreen };
