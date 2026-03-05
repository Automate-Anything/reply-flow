import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover';
import { ArrowDownUp, Building2, Filter, MapPin, Tag, Calendar, SlidersHorizontal } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { ContactFilters as FilterState } from '@/hooks/useContacts';
import type { ContactTag } from '@/hooks/useContactTags';
import type { ContactList } from '@/hooks/useContactLists';
import type { CustomFieldDefinition } from '@/hooks/useCustomFields';

interface ContactFiltersProps {
  filters: FilterState;
  onFiltersChange: (filters: FilterState) => void;
  availableTags: ContactTag[];
  availableLists: ContactList[];
  customFieldDefinitions?: CustomFieldDefinition[];
}

export default function ContactFilters({
  filters,
  onFiltersChange,
  availableTags,
  availableLists,
  customFieldDefinitions,
}: ContactFiltersProps) {
  const updateFilter = (key: keyof FilterState, value: unknown) => {
    onFiltersChange({ ...filters, [key]: value });
  };

  const updateCustomField = (defId: string, value: string | undefined) => {
    const current = filters.customFields || {};
    if (!value) {
      const { [defId]: _, ...rest } = current;
      onFiltersChange({
        ...filters,
        customFields: Object.keys(rest).length > 0 ? rest : undefined,
      });
    } else {
      onFiltersChange({
        ...filters,
        customFields: { ...current, [defId]: value },
      });
    }
  };

  const isTagActive = filters.tags && filters.tags.length > 0;
  const isListActive = !!filters.listId;
  const isCompanyActive = !!filters.company;
  const isCityActive = !!filters.city;
  const isCountryActive = !!filters.country;
  const isDateActive = !!filters.createdAfter || !!filters.createdBefore;
  const isCustomFieldActive = filters.customFields && Object.keys(filters.customFields).length > 0;

  const activeFilterCount = [
    isTagActive,
    isListActive,
    isCompanyActive,
    isCityActive,
    isCountryActive,
    isDateActive,
    isCustomFieldActive,
  ].filter(Boolean).length;

  const hasActiveFilters = activeFilterCount > 0;

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button
          variant={hasActiveFilters ? 'secondary' : 'ghost'}
          size="icon"
          className="relative h-9 w-9 shrink-0"
          title="Filters"
        >
          <Filter className="h-4 w-4" />
          {hasActiveFilters && (
            <Badge className="absolute -right-1 -top-1 h-4 min-w-4 px-1 text-[10px]">
              {activeFilterCount}
            </Badge>
          )}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-72 p-3">
        <div className="flex items-center justify-between">
          <span className="text-xs font-medium text-muted-foreground">Filters</span>
          {hasActiveFilters && (
            <Button
              variant="ghost"
              size="sm"
              className="h-auto px-1.5 py-0.5 text-xs text-muted-foreground"
              onClick={() => onFiltersChange({})}
            >
              Clear all
            </Button>
          )}
        </div>

        <div className="mt-3 space-y-2.5">
          {/* Tag filter — multi-select */}
          {availableTags.length > 0 && (
            <FilterRow
              icon={<Tag className="h-3.5 w-3.5" />}
              label="Tags"
              active={!!isTagActive}
            >
              <Popover>
                <PopoverTrigger asChild>
                  <Button
                    variant="ghost"
                    className="h-7 w-full justify-start border-transparent bg-muted/60 px-2 text-xs shadow-none font-normal"
                  >
                    {filters.tags?.length
                      ? `${filters.tags.length} selected`
                      : 'All'}
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-48 p-2" align="start">
                  <div className="max-h-48 space-y-0.5 overflow-auto">
                    {availableTags.map((tag) => {
                      const isChecked = filters.tags?.includes(tag.name) || false;
                      return (
                        <label
                          key={tag.id}
                          className="flex cursor-pointer items-center gap-2 rounded px-1.5 py-1 text-xs hover:bg-accent"
                        >
                          <Checkbox
                            checked={isChecked}
                            onCheckedChange={(checked) => {
                              const current = filters.tags || [];
                              if (checked) {
                                updateFilter('tags', [...current, tag.name]);
                              } else {
                                const next = current.filter((t) => t !== tag.name);
                                updateFilter('tags', next.length > 0 ? next : undefined);
                              }
                            }}
                          />
                          <span
                            className="h-2 w-2 shrink-0 rounded-full"
                            style={{ backgroundColor: tag.color }}
                          />
                          {tag.name}
                        </label>
                      );
                    })}
                  </div>
                </PopoverContent>
              </Popover>
            </FilterRow>
          )}

          {/* List filter */}
          {availableLists.length > 0 && (
            <FilterRow
              icon={<Filter className="h-3.5 w-3.5" />}
              label="List"
              active={isListActive}
            >
              <Select
                value={filters.listId || 'all'}
                onValueChange={(v) => updateFilter('listId', v === 'all' ? undefined : v)}
              >
                <SelectTrigger className="h-7 w-full border-transparent bg-muted/60 px-2 text-xs shadow-none">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All</SelectItem>
                  {availableLists.map((list) => (
                    <SelectItem key={list.id} value={list.id}>
                      <span className="flex items-center gap-2">
                        <span
                          className="h-2 w-2 rounded-full"
                          style={{ backgroundColor: list.color }}
                        />
                        {list.name}
                      </span>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </FilterRow>
          )}

          {/* Company filter */}
          <FilterRow
            icon={<Building2 className="h-3.5 w-3.5" />}
            label="Company"
            active={isCompanyActive}
          >
            <Input
              className="h-7 border-transparent bg-muted/60 px-2 text-xs shadow-none"
              placeholder="Filter..."
              value={filters.company || ''}
              onChange={(e) => updateFilter('company', e.target.value || undefined)}
            />
          </FilterRow>

          {/* City filter */}
          <FilterRow
            icon={<MapPin className="h-3.5 w-3.5" />}
            label="City"
            active={isCityActive}
          >
            <Input
              className="h-7 border-transparent bg-muted/60 px-2 text-xs shadow-none"
              placeholder="Filter..."
              value={filters.city || ''}
              onChange={(e) => updateFilter('city', e.target.value || undefined)}
            />
          </FilterRow>

          {/* Country filter */}
          <FilterRow
            icon={<MapPin className="h-3.5 w-3.5" />}
            label="Country"
            active={isCountryActive}
          >
            <Input
              className="h-7 border-transparent bg-muted/60 px-2 text-xs shadow-none"
              placeholder="Filter..."
              value={filters.country || ''}
              onChange={(e) => updateFilter('country', e.target.value || undefined)}
            />
          </FilterRow>

          {/* Date range */}
          <FilterRow
            icon={<Calendar className="h-3.5 w-3.5" />}
            label="Created"
            active={isDateActive}
          >
            <div className="flex flex-col gap-1">
              <Input
                type="date"
                className="h-7 w-full border-transparent bg-muted/60 px-1.5 text-xs shadow-none"
                value={filters.createdAfter || ''}
                onChange={(e) => updateFilter('createdAfter', e.target.value || undefined)}
              />
              <Input
                type="date"
                className="h-7 w-full border-transparent bg-muted/60 px-1.5 text-xs shadow-none"
                value={filters.createdBefore || ''}
                onChange={(e) => updateFilter('createdBefore', e.target.value || undefined)}
              />
            </div>
          </FilterRow>
        </div>

        {/* Custom Fields */}
        {customFieldDefinitions && customFieldDefinitions.length > 0 && (
          <div className="mt-3 border-t pt-3">
            <span className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
              Custom Fields
            </span>
            <div className="mt-2 max-h-40 space-y-2.5 overflow-y-auto">
              {customFieldDefinitions.map((def) => (
                <CustomFieldFilterRow
                  key={def.id}
                  definition={def}
                  value={filters.customFields?.[def.id]}
                  onChange={(val) => updateCustomField(def.id, val)}
                />
              ))}
            </div>
          </div>
        )}

        {/* Sort */}
        <div className="mt-3 border-t pt-3">
          <div className="flex items-center gap-2">
            <ArrowDownUp className="h-3.5 w-3.5 text-muted-foreground" />
            <span className="text-xs text-muted-foreground">Sort</span>
            <Select
              value={filters.sortBy || 'updated_at'}
              onValueChange={(v) => updateFilter('sortBy', v as FilterState['sortBy'])}
            >
              <SelectTrigger className="ml-auto h-7 w-auto border-transparent bg-muted/60 px-2 text-xs shadow-none">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="updated_at">Updated</SelectItem>
                <SelectItem value="created_at">Created</SelectItem>
                <SelectItem value="name">Name</SelectItem>
                <SelectItem value="company">Company</SelectItem>
              </SelectContent>
            </Select>
            <Select
              value={filters.sortOrder || 'desc'}
              onValueChange={(v) => updateFilter('sortOrder', v as 'asc' | 'desc')}
            >
              <SelectTrigger className="h-7 w-auto border-transparent bg-muted/60 px-2 text-xs shadow-none">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="desc">Newest</SelectItem>
                <SelectItem value="asc">Oldest</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>
      </PopoverContent>
    </Popover>
  );
}

function FilterRow({
  icon,
  label,
  active,
  children,
}: {
  icon: React.ReactNode;
  label: string;
  active: boolean;
  children: React.ReactNode;
}) {
  return (
    <div className="flex items-center gap-2">
      <div className={cn('text-muted-foreground', active && 'text-primary')}>{icon}</div>
      <span className={cn('w-16 shrink-0 text-xs', active && 'font-medium text-primary')}>
        {label}
      </span>
      <div className="flex-1">{children}</div>
    </div>
  );
}

function CustomFieldFilterRow({
  definition,
  value,
  onChange,
}: {
  definition: CustomFieldDefinition;
  value: string | undefined;
  onChange: (val: string | undefined) => void;
}) {
  const isActive = !!value;

  const renderInput = () => {
    switch (definition.field_type) {
      case 'short_text':
      case 'long_text':
        return (
          <Input
            className="h-7 border-transparent bg-muted/60 px-2 text-xs shadow-none"
            placeholder="Filter..."
            value={value || ''}
            onChange={(e) => onChange(e.target.value || undefined)}
          />
        );
      case 'number':
        return (
          <Input
            type="number"
            className="h-7 border-transparent bg-muted/60 px-2 text-xs shadow-none"
            placeholder="Filter..."
            value={value || ''}
            onChange={(e) => onChange(e.target.value || undefined)}
          />
        );
      case 'dropdown':
      case 'radio':
        return (
          <Select
            value={value || 'all'}
            onValueChange={(v) => onChange(v === 'all' ? undefined : v)}
          >
            <SelectTrigger className="h-7 w-full border-transparent bg-muted/60 px-2 text-xs shadow-none">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All</SelectItem>
              {definition.options.map((opt) => (
                <SelectItem key={opt} value={opt}>
                  {opt}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        );
      case 'multi_select': {
        const selected = value ? value.split(',') : [];
        return (
          <Popover>
            <PopoverTrigger asChild>
              <Button
                variant="ghost"
                className="h-7 w-full justify-start border-transparent bg-muted/60 px-2 text-xs shadow-none font-normal"
              >
                {selected.length ? `${selected.length} selected` : 'All'}
              </Button>
            </PopoverTrigger>
            <PopoverContent className="w-48 p-2" align="start">
              <div className="max-h-36 space-y-0.5 overflow-auto">
                {definition.options.map((opt) => (
                  <label
                    key={opt}
                    className="flex cursor-pointer items-center gap-2 rounded px-1.5 py-1 text-xs hover:bg-accent"
                  >
                    <Checkbox
                      checked={selected.includes(opt)}
                      onCheckedChange={(checked) => {
                        const next = checked
                          ? [...selected, opt]
                          : selected.filter((s) => s !== opt);
                        onChange(next.length > 0 ? next.join(',') : undefined);
                      }}
                    />
                    {opt}
                  </label>
                ))}
              </div>
            </PopoverContent>
          </Popover>
        );
      }
      default:
        return null;
    }
  };

  return (
    <FilterRow
      icon={<SlidersHorizontal className="h-3.5 w-3.5" />}
      label={definition.name}
      active={isActive}
    >
      {renderInput()}
    </FilterRow>
  );
}
