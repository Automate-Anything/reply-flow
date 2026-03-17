import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import type { Schedule } from './ScheduleListTab';

interface Props {
  schedule: Schedule;
}

export function SchedulePreview({ schedule }: Props) {
  // Build a preview of what the affiliate earns at each payment number
  const rows: { paymentNumber: string; rate: string }[] = [];

  for (const period of schedule.periods) {
    const rateLabel =
      schedule.commission_type === 'percentage'
        ? `${period.rate}%`
        : `$${period.rate.toFixed(2)}`;

    if (period.from_payment === period.to_payment) {
      rows.push({ paymentNumber: `#${period.from_payment}`, rate: rateLabel });
    } else {
      rows.push({
        paymentNumber: `#${period.from_payment} - #${period.to_payment}`,
        rate: rateLabel,
      });
    }
  }

  // Add end behavior row
  const lastPeriod = schedule.periods[schedule.periods.length - 1];
  if (lastPeriod) {
    const afterPayment = lastPeriod.to_payment + 1;
    switch (schedule.end_behavior) {
      case 'stop':
        rows.push({ paymentNumber: `#${afterPayment}+`, rate: 'No commission' });
        break;
      case 'continue_last':
        rows.push({
          paymentNumber: `#${afterPayment}+`,
          rate:
            schedule.commission_type === 'percentage'
              ? `${lastPeriod.rate}% (continues)`
              : `$${lastPeriod.rate.toFixed(2)} (continues)`,
        });
        break;
      case 'custom_rate':
        rows.push({
          paymentNumber: `#${afterPayment}+`,
          rate:
            schedule.commission_type === 'percentage'
              ? `${schedule.end_rate ?? 0}%`
              : `$${(schedule.end_rate ?? 0).toFixed(2)}`,
        });
        break;
    }
  }

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base">
          Schedule Preview: {schedule.name}
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="rounded-md border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Payment #</TableHead>
                <TableHead>Rate</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((row, i) => (
                <TableRow key={i}>
                  <TableCell className="font-medium">{row.paymentNumber}</TableCell>
                  <TableCell>{row.rate}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      </CardContent>
    </Card>
  );
}
