ALTER TABLE public.notifications
  DROP CONSTRAINT IF EXISTS notifications_type_check;

ALTER TABLE public.notifications
  ADD CONSTRAINT notifications_type_check
  CHECK (
    type IN (
      'auto_quest',
      'approval_required',
      'approval_result',
      'schedule_conflict',
      'system_alert',
      'month_close_reminder'
    )
  );
