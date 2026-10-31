-- Make the system owner the first administrator (run once, after 001_init.sql).
insert into public.app_users(email, role) values ('sobhyelsaify3600@gmail.com','admin')
on conflict (email) do update set role = 'admin';
