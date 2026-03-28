CREATE TABLE "task_executions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"task_id" uuid NOT NULL,
	"machine_name" text NOT NULL,
	"daemon_id" text,
	"status" text DEFAULT 'assigned' NOT NULL,
	"result" text,
	"started_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "task_comments" ADD COLUMN "execution_id" uuid;--> statement-breakpoint
ALTER TABLE "tasks" ADD COLUMN "mode" text DEFAULT 'single' NOT NULL;--> statement-breakpoint
ALTER TABLE "tasks" ADD COLUMN "targets" text[];--> statement-breakpoint
ALTER TABLE "tasks" ADD COLUMN "exclude_targets" text[];--> statement-breakpoint
ALTER TABLE "task_executions" ADD CONSTRAINT "task_executions_task_id_tasks_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."tasks"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task_comments" ADD CONSTRAINT "task_comments_execution_id_task_executions_id_fk" FOREIGN KEY ("execution_id") REFERENCES "public"."task_executions"("id") ON DELETE cascade ON UPDATE no action;