import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { useTeamMembers } from '@/hooks/useTeamMembers';
import { Users, Loader2 } from 'lucide-react';

interface TeamMemberMultiSelectProps {
  value: string[];
  onChange: (ids: string[]) => void;
}

export function TeamMemberMultiSelect({ value, onChange }: TeamMemberMultiSelectProps) {
  const { members, loading } = useTeamMembers();

  const handleToggle = (userId: string) => {
    if (value.includes(userId)) {
      onChange(value.filter((id) => id !== userId));
    } else {
      onChange([...value, userId]);
    }
  };

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button variant="outline" className="w-full justify-start">
          <Users className="h-4 w-4 mr-2" />
          {value.length === 0
            ? 'Select team members...'
            : `${value.length} member${value.length !== 1 ? 's' : ''} selected`}
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-72 p-2" align="start">
        {loading ? (
          <div className="flex items-center justify-center py-4">
            <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
          </div>
        ) : members.length === 0 ? (
          <p className="text-sm text-muted-foreground text-center py-4">
            No team members found.
          </p>
        ) : (
          <div className="max-h-60 overflow-y-auto space-y-1">
            {members.map((member) => (
              <label
                key={member.user_id}
                className="flex items-center gap-2 rounded-md px-2 py-1.5 text-sm cursor-pointer hover:bg-accent"
              >
                <Checkbox
                  checked={value.includes(member.user_id)}
                  onCheckedChange={() => handleToggle(member.user_id)}
                />
                <span className="truncate">{member.full_name}</span>
              </label>
            ))}
          </div>
        )}
      </PopoverContent>
    </Popover>
  );
}
