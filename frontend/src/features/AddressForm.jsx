import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { LocateFixed } from 'lucide-react';
import { api, errMsg, errFields } from '../services/api';
import { Input, Button, ErrorNote, Checkbox } from '../components/ui';
import { useAuth } from '../hooks/useSite';

export default function AddressForm({ initial, onSaved, onCancel }) {
  const { user } = useAuth();
  const [err, setErr] = useState(null);
  const [geo, setGeo] = useState(initial?.lat ? { lat: initial.lat, lng: initial.lng } : null);
  const { register, handleSubmit, setError, formState: { errors, isSubmitting } } = useForm({
    defaultValues: initial ? { label: initial.label, contactName: initial.contact_name, contactPhone: initial.contact_phone, line1: initial.line1, line2: initial.line2 || '', landmark: initial.landmark || '', city: initial.city, state: initial.state, pincode: initial.pincode, isDefault: !!initial.is_default }
      : { label: 'Home', contactName: user?.name || '', contactPhone: user?.phone || '', city: 'Medininagar', state: 'Jharkhand' },
  });
  const locate = () => navigator.geolocation?.getCurrentPosition((p) => setGeo({ lat: +p.coords.latitude.toFixed(6), lng: +p.coords.longitude.toFixed(6) }), () => setErr('Location permission was denied. You can still save the address.'));
  const submit = async (v) => {
    setErr(null);
    try {
      const body = { ...v, ...(geo || {}) };
      const r = initial ? await api.put(`/account/addresses/${initial.id}`, body) : await api.post('/account/addresses', body);
      onSaved?.(r.data);
    } catch (e) { Object.entries(errFields(e)).forEach(([k, m]) => setError(k, { message: m })); setErr(errMsg(e)); }
  };
  return (
    <form onSubmit={handleSubmit(submit)} className="grid gap-3 sm:grid-cols-2" noValidate>
      <Input label="Contact name" error={errors.contactName?.message} {...register('contactName', { required: 'Enter a name' })} />
      <Input label="Contact mobile" inputMode="numeric" maxLength={10} error={errors.contactPhone?.message} {...register('contactPhone', { required: 'Enter a mobile number', pattern: { value: /^[6-9]\d{9}$/, message: '10-digit mobile' } })} />
      <Input className="sm:col-span-2" label="House, building, street" error={errors.line1?.message} {...register('line1', { required: 'Enter the address' })} />
      <Input label="Area (optional)" {...register('line2')} />
      <Input label="Landmark (optional)" {...register('landmark')} />
      <Input label="City / town" error={errors.city?.message} {...register('city', { required: 'Enter the city' })} />
      <Input label="Pincode" inputMode="numeric" maxLength={6} error={errors.pincode?.message} {...register('pincode', { required: 'Enter the pincode', pattern: { value: /^\d{6}$/, message: '6 digits' } })} />
      <Input label="State" {...register('state', { required: true })} />
      <Input label="Save as" placeholder="Home, Shop, Office" {...register('label')} />
      <div className="flex flex-wrap items-center gap-4 sm:col-span-2">
        <button type="button" className="btn-outline btn-sm" onClick={locate}><LocateFixed className="size-4" />{geo ? 'Location pinned' : 'Pin my location'}</button>
        <span className="text-[12.5px] text-ink-soft">Helps our delivery partner find you.</span>
        <Checkbox label="Make this my default address" {...register('isDefault')} />
      </div>
      <div className="sm:col-span-2"><ErrorNote>{err}</ErrorNote></div>
      <div className="flex gap-2 sm:col-span-2">
        <Button busy={isSubmitting}>Save address</Button>
        {onCancel && <button type="button" className="btn-ghost" onClick={onCancel}>Cancel</button>}
      </div>
    </form>
  );
}
