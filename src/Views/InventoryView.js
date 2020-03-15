import React from 'react';

class InventoryView extends React.Component{
    renderItemStack(itemStack) {
        return (
            <div>{itemStack.toString()}</div>
        );
    }
    render() {
        var items = Object.entries(this.props.inventory).map(([id, itemStack]) => this.renderItemStack(itemStack));
        return (
            <div>
                {items}
            </div>
        );
    }
}
export default InventoryView;