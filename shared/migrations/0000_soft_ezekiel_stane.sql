CREATE TABLE "availability_overrides" (
	"id" uuid PRIMARY KEY NOT NULL,
	"owner_id" uuid,
	"cook_id" uuid NOT NULL,
	"date" date NOT NULL,
	"start_time" time,
	"end_time" time,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "availability_weekly" (
	"id" uuid PRIMARY KEY NOT NULL,
	"owner_id" uuid,
	"cook_id" uuid NOT NULL,
	"weekday" integer NOT NULL,
	"start_time" time NOT NULL,
	"end_time" time NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "batches" (
	"id" uuid PRIMARY KEY NOT NULL,
	"owner_id" uuid,
	"service_id" uuid NOT NULL,
	"sub_recipe_id" uuid NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "batches_service_sub_recipe" UNIQUE("service_id","sub_recipe_id")
);
--> statement-breakpoint
CREATE TABLE "conversions" (
	"id" uuid PRIMARY KEY NOT NULL,
	"owner_id" uuid,
	"ingredient_id" uuid NOT NULL,
	"from_unit" text NOT NULL,
	"to_unit" text NOT NULL,
	"factor" numeric NOT NULL,
	"source" text NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "cooks" (
	"id" uuid PRIMARY KEY NOT NULL,
	"owner_id" uuid,
	"name" text NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "courses" (
	"id" uuid PRIMARY KEY NOT NULL,
	"owner_id" uuid,
	"menu_id" uuid NOT NULL,
	"name" text NOT NULL,
	"position" text NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "dishes" (
	"id" uuid PRIMARY KEY NOT NULL,
	"owner_id" uuid,
	"course_id" uuid NOT NULL,
	"recipe_id" uuid NOT NULL,
	"position" text NOT NULL,
	"scale_factor" numeric,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "ingredient_aliases" (
	"id" uuid PRIMARY KEY NOT NULL,
	"owner_id" uuid,
	"ingredient_id" uuid NOT NULL,
	"name" text NOT NULL,
	"source" text NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "ingredient_lines" (
	"id" uuid PRIMARY KEY NOT NULL,
	"owner_id" uuid,
	"step_id" uuid NOT NULL,
	"ingredient_id" uuid,
	"sub_recipe_id" uuid,
	"quantity" numeric,
	"unit" text,
	"wording" text,
	"preparation" text,
	"fixed_quantity" boolean DEFAULT false NOT NULL,
	"position" text NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "ingredient_lines_one_target" CHECK ("ingredient_lines"."ingredient_id" is null or "ingredient_lines"."sub_recipe_id" is null)
);
--> statement-breakpoint
CREATE TABLE "ingredient_overrides" (
	"id" uuid PRIMARY KEY NOT NULL,
	"owner_id" uuid,
	"ingredient_id" uuid NOT NULL,
	"main_unit" text,
	"shopping_category_id" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "ingredients" (
	"id" uuid PRIMARY KEY NOT NULL,
	"owner_id" uuid,
	"name" text NOT NULL,
	"fdc_id" text,
	"source" text NOT NULL,
	"preferred_kind" text,
	"main_unit" text,
	"shopping_category_id" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "kitchen_settings" (
	"id" uuid PRIMARY KEY NOT NULL,
	"owner_id" uuid,
	"mass_unit" text DEFAULT 'g' NOT NULL,
	"volume_unit" text DEFAULT 'ml' NOT NULL,
	"count_unit" text DEFAULT 'each' NOT NULL,
	"unit_region" text DEFAULT 'metric' NOT NULL,
	"default_service_time" time,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "menus" (
	"id" uuid PRIMARY KEY NOT NULL,
	"owner_id" uuid,
	"name" text NOT NULL,
	"guest_count" integer,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "recipe_revisions" (
	"id" uuid PRIMARY KEY NOT NULL,
	"owner_id" uuid,
	"recipe_id" uuid NOT NULL,
	"number" integer NOT NULL,
	"snapshot" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "recipe_revisions_number" UNIQUE("recipe_id","number")
);
--> statement-breakpoint
CREATE TABLE "recipes" (
	"id" uuid PRIMARY KEY NOT NULL,
	"owner_id" uuid,
	"name" text NOT NULL,
	"servings" numeric,
	"yield_text" text,
	"make_ahead_before_days" integer,
	"shelf_life_days" integer,
	"source" text,
	"latest_revision" integer DEFAULT 1 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "services" (
	"id" uuid PRIMARY KEY NOT NULL,
	"owner_id" uuid,
	"menu_id" uuid NOT NULL,
	"date" date NOT NULL,
	"time" time,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "services_menu_id_unique" UNIQUE("menu_id")
);
--> statement-breakpoint
CREATE TABLE "shopping_categories" (
	"id" uuid PRIMARY KEY NOT NULL,
	"owner_id" uuid,
	"name" text NOT NULL,
	"position" text NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "shopping_marks" (
	"id" uuid PRIMARY KEY NOT NULL,
	"owner_id" uuid,
	"service_id" uuid NOT NULL,
	"ingredient_id" uuid NOT NULL,
	"status" text NOT NULL,
	"amount" numeric,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "shopping_marks_line" UNIQUE("service_id","ingredient_id")
);
--> statement-breakpoint
CREATE TABLE "step_dependencies" (
	"id" uuid PRIMARY KEY NOT NULL,
	"owner_id" uuid,
	"recipe_id" uuid NOT NULL,
	"before_step_id" uuid NOT NULL,
	"after_step_id" uuid NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "step_dependencies_pair" UNIQUE("before_step_id","after_step_id")
);
--> statement-breakpoint
CREATE TABLE "step_events" (
	"id" uuid PRIMARY KEY NOT NULL,
	"owner_id" uuid,
	"service_id" uuid NOT NULL,
	"dish_id" uuid,
	"batch_id" uuid,
	"step_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"at" timestamp with time zone NOT NULL,
	CONSTRAINT "step_events_one_owner" CHECK (("step_events"."dish_id" is null) <> ("step_events"."batch_id" is null))
);
--> statement-breakpoint
CREATE TABLE "steps" (
	"id" uuid PRIMARY KEY NOT NULL,
	"owner_id" uuid,
	"recipe_id" uuid NOT NULL,
	"position" text NOT NULL,
	"body" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"active_minutes" integer,
	"passive_minutes" integer,
	"make_ahead_before_days" integer,
	"shelf_life_days" integer,
	"group_with_previous" boolean DEFAULT false NOT NULL,
	"station_id" uuid,
	"mise_en_place" boolean,
	"serve_straight_away" boolean DEFAULT false NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "task_placements" (
	"id" uuid PRIMARY KEY NOT NULL,
	"owner_id" uuid,
	"service_id" uuid NOT NULL,
	"dish_id" uuid,
	"batch_id" uuid,
	"first_step_id" uuid NOT NULL,
	"start_minute" integer NOT NULL,
	"cook_id" uuid,
	"pinned" boolean DEFAULT false NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "task_placements_task" UNIQUE NULLS NOT DISTINCT("service_id","dish_id","batch_id","first_step_id"),
	CONSTRAINT "task_placements_one_owner" CHECK (("task_placements"."dish_id" is null) <> ("task_placements"."batch_id" is null))
);
--> statement-breakpoint
ALTER TABLE "availability_overrides" ADD CONSTRAINT "availability_overrides_cook_id_cooks_id_fk" FOREIGN KEY ("cook_id") REFERENCES "public"."cooks"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "availability_weekly" ADD CONSTRAINT "availability_weekly_cook_id_cooks_id_fk" FOREIGN KEY ("cook_id") REFERENCES "public"."cooks"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "batches" ADD CONSTRAINT "batches_service_id_services_id_fk" FOREIGN KEY ("service_id") REFERENCES "public"."services"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "batches" ADD CONSTRAINT "batches_sub_recipe_id_recipes_id_fk" FOREIGN KEY ("sub_recipe_id") REFERENCES "public"."recipes"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conversions" ADD CONSTRAINT "conversions_ingredient_id_ingredients_id_fk" FOREIGN KEY ("ingredient_id") REFERENCES "public"."ingredients"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "courses" ADD CONSTRAINT "courses_menu_id_menus_id_fk" FOREIGN KEY ("menu_id") REFERENCES "public"."menus"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dishes" ADD CONSTRAINT "dishes_course_id_courses_id_fk" FOREIGN KEY ("course_id") REFERENCES "public"."courses"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dishes" ADD CONSTRAINT "dishes_recipe_id_recipes_id_fk" FOREIGN KEY ("recipe_id") REFERENCES "public"."recipes"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ingredient_aliases" ADD CONSTRAINT "ingredient_aliases_ingredient_id_ingredients_id_fk" FOREIGN KEY ("ingredient_id") REFERENCES "public"."ingredients"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ingredient_lines" ADD CONSTRAINT "ingredient_lines_step_id_steps_id_fk" FOREIGN KEY ("step_id") REFERENCES "public"."steps"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ingredient_lines" ADD CONSTRAINT "ingredient_lines_ingredient_id_ingredients_id_fk" FOREIGN KEY ("ingredient_id") REFERENCES "public"."ingredients"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ingredient_lines" ADD CONSTRAINT "ingredient_lines_sub_recipe_id_recipes_id_fk" FOREIGN KEY ("sub_recipe_id") REFERENCES "public"."recipes"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ingredient_overrides" ADD CONSTRAINT "ingredient_overrides_ingredient_id_ingredients_id_fk" FOREIGN KEY ("ingredient_id") REFERENCES "public"."ingredients"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ingredient_overrides" ADD CONSTRAINT "ingredient_overrides_shopping_category_id_shopping_categories_id_fk" FOREIGN KEY ("shopping_category_id") REFERENCES "public"."shopping_categories"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ingredients" ADD CONSTRAINT "ingredients_shopping_category_id_shopping_categories_id_fk" FOREIGN KEY ("shopping_category_id") REFERENCES "public"."shopping_categories"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recipe_revisions" ADD CONSTRAINT "recipe_revisions_recipe_id_recipes_id_fk" FOREIGN KEY ("recipe_id") REFERENCES "public"."recipes"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "services" ADD CONSTRAINT "services_menu_id_menus_id_fk" FOREIGN KEY ("menu_id") REFERENCES "public"."menus"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shopping_marks" ADD CONSTRAINT "shopping_marks_service_id_services_id_fk" FOREIGN KEY ("service_id") REFERENCES "public"."services"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shopping_marks" ADD CONSTRAINT "shopping_marks_ingredient_id_ingredients_id_fk" FOREIGN KEY ("ingredient_id") REFERENCES "public"."ingredients"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "step_dependencies" ADD CONSTRAINT "step_dependencies_recipe_id_recipes_id_fk" FOREIGN KEY ("recipe_id") REFERENCES "public"."recipes"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "step_dependencies" ADD CONSTRAINT "step_dependencies_before_step_id_steps_id_fk" FOREIGN KEY ("before_step_id") REFERENCES "public"."steps"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "step_dependencies" ADD CONSTRAINT "step_dependencies_after_step_id_steps_id_fk" FOREIGN KEY ("after_step_id") REFERENCES "public"."steps"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "step_events" ADD CONSTRAINT "step_events_service_id_services_id_fk" FOREIGN KEY ("service_id") REFERENCES "public"."services"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "step_events" ADD CONSTRAINT "step_events_dish_id_dishes_id_fk" FOREIGN KEY ("dish_id") REFERENCES "public"."dishes"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "step_events" ADD CONSTRAINT "step_events_batch_id_batches_id_fk" FOREIGN KEY ("batch_id") REFERENCES "public"."batches"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "step_events" ADD CONSTRAINT "step_events_step_id_steps_id_fk" FOREIGN KEY ("step_id") REFERENCES "public"."steps"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "steps" ADD CONSTRAINT "steps_recipe_id_recipes_id_fk" FOREIGN KEY ("recipe_id") REFERENCES "public"."recipes"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task_placements" ADD CONSTRAINT "task_placements_service_id_services_id_fk" FOREIGN KEY ("service_id") REFERENCES "public"."services"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task_placements" ADD CONSTRAINT "task_placements_dish_id_dishes_id_fk" FOREIGN KEY ("dish_id") REFERENCES "public"."dishes"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task_placements" ADD CONSTRAINT "task_placements_batch_id_batches_id_fk" FOREIGN KEY ("batch_id") REFERENCES "public"."batches"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task_placements" ADD CONSTRAINT "task_placements_first_step_id_steps_id_fk" FOREIGN KEY ("first_step_id") REFERENCES "public"."steps"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task_placements" ADD CONSTRAINT "task_placements_cook_id_cooks_id_fk" FOREIGN KEY ("cook_id") REFERENCES "public"."cooks"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "ingredient_aliases_name_idx" ON "ingredient_aliases" USING btree ("name");--> statement-breakpoint
CREATE INDEX "step_events_service_idx" ON "step_events" USING btree ("service_id");--> statement-breakpoint
CREATE INDEX "steps_recipe_idx" ON "steps" USING btree ("recipe_id");