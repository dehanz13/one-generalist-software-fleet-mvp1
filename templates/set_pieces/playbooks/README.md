# Playbooks

A playbook is a chain of players written as data: each player's match report
is handed to the next. Make one with

    ogsf write-playbook --name review_docs --players ranger,builder

and run it with

    ogsf play review_docs "tidy the README"

Then replace each step's `description`: it is the only sentence about intent
that the record, the console and Matchday Live ever show. A description that
only restates the step's name is refused when the match starts.
