import { useEffect, useState } from 'react';
import { AlertTriangle, X } from 'lucide-react';
import { Link } from 'react-router-dom';
import api from '@/lib/api';

interface BillingStatus {
  balance_cents: number;
  renewal_failed_at: string | null;
  grace_period_ends_at: string | null;
}

interface UsageMessages {
  used: number;
  included: number;
}

export default function BillingBanners() {
  const [billingStatus, setBillingStatus] = useState<BillingStatus | null>(null);
  const [messagesUsage, setMessagesUsage] = useState<UsageMessages | null>(null);
  const [dismissedOverage, setDismissedOverage] = useState(false);
  const [dismissedRenewal, setDismissedRenewal] = useState(false);

  useEffect(() => {
    // Fetch balance info and usage info in parallel
    Promise.all([
      api.get('/billing/balance').then((r) => r.data).catch(() => null),
      api.get('/billing/usage').then((r) => r.data).catch(() => null),
    ]).then(([balance, usage]) => {
      if (balance) setBillingStatus(balance);
      if (usage?.usage?.messages) setMessagesUsage(usage.usage.messages);
    });
  }, []);

  if (!billingStatus) return null;

  const isOverLimit =
    messagesUsage !== null && messagesUsage.used >= messagesUsage.included;
  const hasNoBalance = billingStatus.balance_cents <= 0;
  const showOverageBanner = isOverLimit && hasNoBalance && !dismissedOverage;

  const renewalFailed = !!billingStatus.renewal_failed_at;
  const gracePeriodEndsAt = billingStatus.grace_period_ends_at
    ? new Date(billingStatus.grace_period_ends_at)
    : null;
  const isInGracePeriod = gracePeriodEndsAt !== null && gracePeriodEndsAt > new Date();
  const isPastGracePeriod = gracePeriodEndsAt !== null && gracePeriodEndsAt <= new Date();
  const showRenewalBanner = renewalFailed && !dismissedRenewal;

  if (!showOverageBanner && !showRenewalBanner) return null;

  return (
    <div className="flex flex-col gap-0">
      {showOverageBanner && (
        <div className="flex items-center gap-3 bg-amber-50 border-b border-amber-200 px-4 py-2.5 text-sm text-amber-800">
          <AlertTriangle className="h-4 w-4 shrink-0 text-amber-500" />
          <span className="flex-1">
            Your AI agent is paused — you've used all included messages this month and your balance is $0.{' '}
            <Link
              to="/company-settings?tab=billing"
              className="font-medium underline underline-offset-2 hover:text-amber-900"
            >
              Add balance to resume
            </Link>
          </span>
          <button
            onClick={() => setDismissedOverage(true)}
            className="ml-2 rounded p-0.5 hover:bg-amber-100"
            aria-label="Dismiss"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      )}

      {showRenewalBanner && (
        <div className="flex items-center gap-3 bg-red-50 border-b border-red-200 px-4 py-2.5 text-sm text-red-800">
          <AlertTriangle className="h-4 w-4 shrink-0 text-red-500" />
          <span className="flex-1">
            {isPastGracePeriod ? (
              <>
                Your subscription has expired. Renew to restore your AI agent and messaging service.{' '}
                <Link
                  to="/company-settings?tab=billing"
                  className="font-medium underline underline-offset-2 hover:text-red-900"
                >
                  Renew now
                </Link>
              </>
            ) : isInGracePeriod ? (
              <>
                Your subscription renewal failed. Everything stops working on{' '}
                <strong>
                  {gracePeriodEndsAt!.toLocaleDateString(undefined, {
                    month: 'short',
                    day: 'numeric',
                  })}
                </strong>{' '}
                if payment isn't received.{' '}
                <Link
                  to="/company-settings?tab=billing"
                  className="font-medium underline underline-offset-2 hover:text-red-900"
                >
                  Update payment method
                </Link>
              </>
            ) : (
              <>
                Your subscription renewal failed. Please update your payment method.{' '}
                <Link
                  to="/company-settings?tab=billing"
                  className="font-medium underline underline-offset-2 hover:text-red-900"
                >
                  Update now
                </Link>
              </>
            )}
          </span>
          <button
            onClick={() => setDismissedRenewal(true)}
            className="ml-2 rounded p-0.5 hover:bg-red-100"
            aria-label="Dismiss"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      )}
    </div>
  );
}
