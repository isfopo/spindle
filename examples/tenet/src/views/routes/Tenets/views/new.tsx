import type { FC } from "hono/jsx";
import { useHandler } from "@spindle/spindle/fabric";
import styles from "./new.module.css";
import { TenetDetail } from "domains/tenet/service";
import { AddOptionHandler } from "views/handlers/AddOptionHandler";

/** Renders a single option row with the given index. */
function OptionCard(idx: number) {
  return (
    <article class={styles.optionCard}>
      <legend>Option {idx + 1}</legend>
      <label for={`opt-${idx}-title`}>Title</label>
      <input
        id={`opt-${idx}-title`}
        name={`options[${idx}][title]`}
        type="text"
        required
      />

      <label for={`opt-${idx}-desc`}>Description</label>
      <textarea
        id={`opt-${idx}-desc`}
        name={`options[${idx}][description]`}
        rows={2}
      />

      <div class={styles.prosConsGrid}>
        <label for={`opt-${idx}-pros`}>
          Pros
          <textarea
            id={`opt-${idx}-pros`}
            name={`options[${idx}][pros]`}
            rows={3}
          />
        </label>
        <label for={`opt-${idx}-cons`}>
          Cons
          <textarea
            id={`opt-${idx}-cons`}
            name={`options[${idx}][cons]`}
            rows={3}
          />
        </label>
      </div>
    </article>
  );
}

/** Template for the client-side AddOptionHandler to clone. */
function OptionTemplate() {
  return (
    <template>
      <article class={styles.optionCard}>
        <legend>Option __IDX_PLUS_ONE__</legend>
        <label for="opt-__IDX__-title">Title</label>
        <input
          id="opt-__IDX__-title"
          name="options[__IDX__][title]"
          type="text"
          required
        />

        <label for="opt-__IDX__-desc">Description</label>
        <textarea
          id="opt-__IDX__-desc"
          name="options[__IDX__][description]"
          rows={2}
        />

        <div class={styles.prosConsGrid}>
          <label for="opt-__IDX__-pros">
            Pros
            <textarea
              id="opt-__IDX__-pros"
              name="options[__IDX__][pros]"
              rows={3}
            />
          </label>
          <label for="opt-__IDX__-cons">
            Cons
            <textarea
              id="opt-__IDX__-cons"
              name="options[__IDX__][cons]"
              rows={3}
            />
          </label>
        </div>
      </article>
    </template>
  );
}

export interface TenetFormViewModel {
  isEditing: boolean;
  tenet?: TenetDetail;
  validationErrors?: Record<string, string>;
}

export const View: FC<TenetFormViewModel> = ({ validationErrors }) => {
  const AddOption = useHandler(AddOptionHandler);

  return (
    <section>
      <hgroup>
        <h1>Propose a Tenet</h1>
        <p>Record an architecture decision for your team to review.</p>
      </hgroup>

      <form method="post" action="/tenets">
        <label for="title">Title</label>
        <input
          id="title"
          name="title"
          type="text"
          required
          aria-invalid={validationErrors?.title ? "true" : undefined}
        />
        {validationErrors?.title && <small>{validationErrors.title}</small>}

        <label for="context">Context</label>
        <textarea
          id="context"
          name="context"
          rows={5}
          required
          aria-invalid={validationErrors?.context ? "true" : undefined}
          placeholder="What problem are you trying to solve? What constraints exist?"
        />
        {validationErrors?.context && <small>{validationErrors.context}</small>}

        <fieldset>
          <legend>Options</legend>
          <p>
            <small>
              Each option represents a possible choice. Add pros and cons for
              each.
            </small>
          </p>

          <AddOption start="3">
            <div data-option-container>
              {OptionCard(0)}
              {OptionCard(1)}
            </div>

            {OptionTemplate()}

            <AddOption.Trigger event="click" method="add">
              <button type="button" class="outline">
                + Add option
              </button>
            </AddOption.Trigger>
          </AddOption>

          {validationErrors?.options && (
            <small>{validationErrors.options}</small>
          )}
        </fieldset>

        <button type="submit">Create Tenet</button>
      </form>
    </section>
  );
};

