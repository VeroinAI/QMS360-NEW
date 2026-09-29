import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";

const sections = [
  { id: "organization-chart", title: "Organization chart" },
  { id: "design-status", title: "Design Status" },
  { id: "procurement-status", title: "Procurement Status" },
  { id: "good-practices", title: "Conforming and Good Practices" },
] as const;

export function AdditionalDocumentSections() {
  return (
    <Accordion type="multiple" className="space-y-3" aria-label="Additional document sections">
      {sections.map(section => (
        <AccordionItem key={section.id} value={section.id} className="rounded-lg border bg-card px-5 shadow-sm">
          <AccordionTrigger className="py-5 text-base hover:no-underline">
            {section.title}
          </AccordionTrigger>
          <AccordionContent className="border-t pt-4 text-muted-foreground">
            Audit files can be uploaded and viewed in the Evidence files area below.
          </AccordionContent>
        </AccordionItem>
      ))}
    </Accordion>
  );
}