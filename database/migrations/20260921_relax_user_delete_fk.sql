-- Relax ON DELETE RESTRICT to ON DELETE SET NULL for user account deletion
-- validation_requests.submitted_by_user_id
ALTER TABLE public.validation_requests ALTER COLUMN submitted_by_user_id DROP NOT NULL;
ALTER TABLE public.validation_requests DROP CONSTRAINT IF EXISTS validation_requests_submitted_by_user_id_fkey;
ALTER TABLE public.validation_requests ADD CONSTRAINT validation_requests_submitted_by_user_id_fkey
  FOREIGN KEY (submitted_by_user_id) REFERENCES public.app_users(id) ON UPDATE CASCADE ON DELETE SET NULL;

-- validation_request_logs.actor_user_id
ALTER TABLE public.validation_request_logs ALTER COLUMN actor_user_id DROP NOT NULL;
ALTER TABLE public.validation_request_logs DROP CONSTRAINT IF EXISTS validation_request_logs_actor_user_id_fkey;
ALTER TABLE public.validation_request_logs ADD CONSTRAINT validation_request_logs_actor_user_id_fkey
  FOREIGN KEY (actor_user_id) REFERENCES public.app_users(id) ON UPDATE CASCADE ON DELETE SET NULL;
