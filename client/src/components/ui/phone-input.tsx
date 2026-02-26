import { useState, useEffect, useMemo, useRef } from 'react';
import {
  parsePhoneNumber,
  getExampleNumber,
  AsYouType,
  type CountryCode,
} from 'libphonenumber-js';
import examples from 'libphonenumber-js/mobile/examples';
import { cn } from '@/lib/utils';

interface Country {
  code: CountryCode;
  name: string;
  dialCode: string;
  flag: string;
}

const COUNTRIES: Country[] = [
  { code: 'US', name: 'United States', dialCode: '+1', flag: '🇺🇸' },
  { code: 'GB', name: 'United Kingdom', dialCode: '+44', flag: '🇬🇧' },
  { code: 'IL', name: 'Israel', dialCode: '+972', flag: '🇮🇱' },
  { code: 'CA', name: 'Canada', dialCode: '+1', flag: '🇨🇦' },
  { code: 'AU', name: 'Australia', dialCode: '+61', flag: '🇦🇺' },
  { code: 'DE', name: 'Germany', dialCode: '+49', flag: '🇩🇪' },
  { code: 'FR', name: 'France', dialCode: '+33', flag: '🇫🇷' },
  { code: 'IT', name: 'Italy', dialCode: '+39', flag: '🇮🇹' },
  { code: 'ES', name: 'Spain', dialCode: '+34', flag: '🇪🇸' },
  { code: 'BR', name: 'Brazil', dialCode: '+55', flag: '🇧🇷' },
  { code: 'MX', name: 'Mexico', dialCode: '+52', flag: '🇲🇽' },
  { code: 'IN', name: 'India', dialCode: '+91', flag: '🇮🇳' },
  { code: 'JP', name: 'Japan', dialCode: '+81', flag: '🇯🇵' },
  { code: 'KR', name: 'South Korea', dialCode: '+82', flag: '🇰🇷' },
  { code: 'CN', name: 'China', dialCode: '+86', flag: '🇨🇳' },
  { code: 'RU', name: 'Russia', dialCode: '+7', flag: '🇷🇺' },
  { code: 'ZA', name: 'South Africa', dialCode: '+27', flag: '🇿🇦' },
  { code: 'NG', name: 'Nigeria', dialCode: '+234', flag: '🇳🇬' },
  { code: 'EG', name: 'Egypt', dialCode: '+20', flag: '🇪🇬' },
  { code: 'AE', name: 'UAE', dialCode: '+971', flag: '🇦🇪' },
  { code: 'SA', name: 'Saudi Arabia', dialCode: '+966', flag: '🇸🇦' },
  { code: 'TR', name: 'Turkey', dialCode: '+90', flag: '🇹🇷' },
  { code: 'PL', name: 'Poland', dialCode: '+48', flag: '🇵🇱' },
  { code: 'NL', name: 'Netherlands', dialCode: '+31', flag: '🇳🇱' },
  { code: 'SE', name: 'Sweden', dialCode: '+46', flag: '🇸🇪' },
  { code: 'CH', name: 'Switzerland', dialCode: '+41', flag: '🇨🇭' },
  { code: 'AT', name: 'Austria', dialCode: '+43', flag: '🇦🇹' },
  { code: 'BE', name: 'Belgium', dialCode: '+32', flag: '🇧🇪' },
  { code: 'PT', name: 'Portugal', dialCode: '+351', flag: '🇵🇹' },
  { code: 'IE', name: 'Ireland', dialCode: '+353', flag: '🇮🇪' },
  { code: 'NZ', name: 'New Zealand', dialCode: '+64', flag: '🇳🇿' },
  { code: 'SG', name: 'Singapore', dialCode: '+65', flag: '🇸🇬' },
  { code: 'HK', name: 'Hong Kong', dialCode: '+852', flag: '🇭🇰' },
  { code: 'TW', name: 'Taiwan', dialCode: '+886', flag: '🇹🇼' },
  { code: 'TH', name: 'Thailand', dialCode: '+66', flag: '🇹🇭' },
  { code: 'PH', name: 'Philippines', dialCode: '+63', flag: '🇵🇭' },
  { code: 'MY', name: 'Malaysia', dialCode: '+60', flag: '🇲🇾' },
  { code: 'ID', name: 'Indonesia', dialCode: '+62', flag: '🇮🇩' },
  { code: 'VN', name: 'Vietnam', dialCode: '+84', flag: '🇻🇳' },
  { code: 'AR', name: 'Argentina', dialCode: '+54', flag: '🇦🇷' },
  { code: 'CL', name: 'Chile', dialCode: '+56', flag: '🇨🇱' },
  { code: 'CO', name: 'Colombia', dialCode: '+57', flag: '🇨🇴' },
  { code: 'PE', name: 'Peru', dialCode: '+51', flag: '🇵🇪' },
  { code: 'UA', name: 'Ukraine', dialCode: '+380', flag: '🇺🇦' },
  { code: 'RO', name: 'Romania', dialCode: '+40', flag: '🇷🇴' },
  { code: 'CZ', name: 'Czech Republic', dialCode: '+420', flag: '🇨🇿' },
  { code: 'GR', name: 'Greece', dialCode: '+30', flag: '🇬🇷' },
  { code: 'DK', name: 'Denmark', dialCode: '+45', flag: '🇩🇰' },
  { code: 'FI', name: 'Finland', dialCode: '+358', flag: '🇫🇮' },
  { code: 'NO', name: 'Norway', dialCode: '+47', flag: '🇳🇴' },
];

function getPlaceholder(countryCode: CountryCode): string {
  const example = getExampleNumber(countryCode, examples);
  if (!example) return '';
  return example.formatNational();
}

interface PhoneInputProps {
  /** E.164 formatted value, e.g. "+14155551234" */
  value: string;
  onChange: (e164Value: string) => void;
  /** Validation error message to display */
  error?: string;
  disabled?: boolean;
}

export default function PhoneInput({ value, onChange, error, disabled }: PhoneInputProps) {
  const [country, setCountry] = useState<CountryCode>('US');
  const [nationalNumber, setNationalNumber] = useState('');
  const initializedRef = useRef(false);

  // Parse incoming E.164 value into country + national number on mount / value change
  useEffect(() => {
    if (!value) {
      if (!initializedRef.current) initializedRef.current = true;
      return;
    }
    try {
      const parsed = parsePhoneNumber(value);
      if (parsed && parsed.country) {
        setCountry(parsed.country);
        setNationalNumber(parsed.formatNational());
        initializedRef.current = true;
        return;
      }
    } catch {
      // Not a valid E.164 yet — keep current state
    }
    // If we haven't initialized yet, treat raw value as national number
    if (!initializedRef.current) {
      setNationalNumber(value.replace(/^\+/, ''));
      initializedRef.current = true;
    }
  }, [value]);

  const placeholder = useMemo(() => getPlaceholder(country), [country]);

  const handleNationalChange = (raw: string) => {
    // Allow only digits, spaces, dashes, parens
    const cleaned = raw.replace(/[^\d\s\-()/]/g, '');
    setNationalNumber(cleaned);

    // Format as-you-type and emit E.164
    const digitsOnly = cleaned.replace(/\D/g, '');
    if (!digitsOnly) {
      onChange('');
      return;
    }

    const selectedCountry = COUNTRIES.find((c) => c.code === country);
    const fullNumber = (selectedCountry?.dialCode ?? '') + digitsOnly;
    const formatter = new AsYouType(country);
    formatter.input(fullNumber);
    const phoneNumber = formatter.getNumber();

    if (phoneNumber) {
      onChange(phoneNumber.format('E.164'));
    } else {
      // Emit raw dial code + digits so parent always has something
      onChange(fullNumber);
    }
  };

  const handleCountryChange = (newCode: CountryCode) => {
    setCountry(newCode);
    // Re-emit with the new country code
    const digitsOnly = nationalNumber.replace(/\D/g, '');
    if (!digitsOnly) {
      onChange('');
      return;
    }
    const selectedCountry = COUNTRIES.find((c) => c.code === newCode);
    const fullNumber = (selectedCountry?.dialCode ?? '') + digitsOnly;
    const formatter = new AsYouType(newCode);
    formatter.input(fullNumber);
    const phoneNumber = formatter.getNumber();
    if (phoneNumber) {
      onChange(phoneNumber.format('E.164'));
    } else {
      onChange(fullNumber);
    }
  };

  const inputClasses = cn(
    'h-9 w-full min-w-0 rounded-r-md border border-l-0 bg-transparent px-3 py-1 text-base shadow-xs transition-[color,box-shadow] outline-none placeholder:text-muted-foreground md:text-sm',
    'focus-visible:border-ring focus-visible:ring-ring/50 focus-visible:ring-[3px]',
    'disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-50',
    error
      ? 'border-destructive ring-destructive/20 dark:ring-destructive/40'
      : 'border-input'
  );

  const selectClasses = cn(
    'h-9 rounded-l-md border bg-transparent px-2 py-1 text-sm shadow-xs transition-[color,box-shadow] outline-none appearance-none cursor-pointer',
    'focus-visible:border-ring focus-visible:ring-ring/50 focus-visible:ring-[3px]',
    'disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-50',
    error
      ? 'border-destructive ring-destructive/20 dark:ring-destructive/40'
      : 'border-input'
  );

  return (
    <div>
      <div className="flex">
        <select
          value={country}
          onChange={(e) => handleCountryChange(e.target.value as CountryCode)}
          className={selectClasses}
          disabled={disabled}
        >
          {COUNTRIES.map((c) => (
            <option key={c.code} value={c.code}>
              {c.flag} {c.dialCode}
            </option>
          ))}
        </select>
        <input
          type="tel"
          value={nationalNumber}
          onChange={(e) => handleNationalChange(e.target.value)}
          placeholder={placeholder}
          className={inputClasses}
          disabled={disabled}
        />
      </div>
      {error && (
        <p className="mt-1 text-xs text-destructive">{error}</p>
      )}
    </div>
  );
}
