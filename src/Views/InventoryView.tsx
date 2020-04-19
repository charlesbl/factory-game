import React from 'react';
import '../css/Inventory.css'
import ItemStack from '../Game/ItemStack';
import Inventory from '../Game/Inventory';

interface IInventoryProps {
    inventory: Inventory
}

export default class InventoryView extends React.Component<IInventoryProps> {
    renderItemStack(itemStack: ItemStack) {
        return (
            <div className="col-6 col-sm-4 col-md-3 col-lg-2 col-xl-1" key={itemStack.id}>
                <div className="row no-gutters item">
                    <div className="col-7 text-right">
                        <span className="item-name">{itemStack.item.name}:</span>
                    </div>
                    <div className="col-5 text-left">
                        <span>{itemStack.quantity}</span>
                    </div>
                </div>
            </div>
        );
    }
    render() {
        var items = Object.entries(this.props.inventory.itemStacks).filter(([id, itemStack]) => !itemStack.item.infinite).map(([id, itemStack]) => this.renderItemStack(itemStack));
        return (
            <div className="row no-gutters">
                {items}
            </div>
        );
    }
}