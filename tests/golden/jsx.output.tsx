interface CardProps {
    title: string;
    count: number;
}

const compact = <Badge tone={active ? 'success' : 'neutral'}>Keep   exact</Badge>;
const card = <Card title={title} count={items.length} disabled={false} />;
const dashboard = <Dashboard
    title={dashboardTitle}
    subtitle={dashboardSubtitle}
    currentUser={authenticatedUser}
    notifications={notifications}
/>;
const authored = (
    <Card
        title={title}
        actions={<Button onClick={() => save( item.id )}>Save</Button>}
    >
        {content}
    </Card>
);
const rows = items.map( ( item ) => <Row key={item.id} value={item.value} /> );
